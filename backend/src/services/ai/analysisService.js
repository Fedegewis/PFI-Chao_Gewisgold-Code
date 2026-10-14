// 7G: orquestador end-to-end del pipeline IA.
//
// Este módulo compone las capas ya construidas (7C→7F). NO conoce req/res.
// La route (routes/analysis.js) es responsable de auth, ownership HTTP y
// mapeo de errores a status codes.
//
// Deps inyectables (para tests sin Ollama real):
//   { generate, buildContextFromDb, contextBuilder, promptBuilder, validator, repo, config }
//
// En producción, sirve defaults reales apuntando a los módulos de servicios.

import db from "../../db/connection.js";
import {
  generate as defaultGenerate,
  getOllamaConfig,
} from "./ollamaClient.js";
import { OllamaClientError } from "./errors.js";
import {
  buildSessionAnalysisContext,
  CONTEXT_SCHEMA_VERSION,
} from "./contextBuilder.js";
import {
  buildSessionAnalysisPrompt,
  PROMPT_BUILDER_VERSION,
} from "./promptBuilder.js";
import {
  parseAndValidateSessionAnalysis,
  ANALYSIS_SCHEMA_VERSION,
} from "./responseValidator.js";
import { AnalysisValidationError, AnalysisValidationCodes } from "./validationErrors.js";
import { toPersistedErrorCode } from "./errorMapping.js";
import * as defaultRepo from "./analysisRepository.js";
import { withAnalysisLock as defaultWithAnalysisLock } from "./analysisLock.js";
import { loadPreviousSessions, filterComparableSessions, HISTORICAL_SESSION_LIMIT } from "./historicalContext.js";
import { buildEvidenceFromContext } from "./evidenceBuilder.js";
import { buildComparisonMetrics } from "./comparisonBuilder.js";
import { buildObservations } from "./observationsBuilder.js";

// Parámetros de inferencia. num_predict: cota superior de tokens generados.
// v3.0 — bajado a 300. El contrato v3 limita la salida del modelo a
//   { summary (≤500 chars), aspects_to_review (≤5 strings de ≤180 chars) }.
//   ~300 tokens cubren el peor caso con margen y acortan la generación.
export const AI_GENERATE_OPTIONS = Object.freeze({
  temperature: 0.2,
  num_predict: 300,
});

// keep_alive: mantiene el modelo residente en Ollama durante 30 minutos
// tras cada análisis. Reduce cold-start (~10-30s en CPU) para análisis
// consecutivos del profesional en la misma jornada. No indefinido: 30m
// libera memoria cuando la app queda inactiva.
export const AI_KEEP_ALIVE = "30m";

// ------------------------------------------------------------------
// Query real: carga métricas de sesión desde session_results + metadata
// de sections + slugs de cognitive_domains. NUNCA SELECT *.
// NO trae: prompt_snapshot, stimulus_snapshot, correct_answer_snapshot,
// selected_answer, patient name/email, professional email, etc.
// ------------------------------------------------------------------

export async function loadSessionAnalysisInput(dbOrTrx, sessionId) {
  const globalRow = await dbOrTrx("session_results")
    .where({ session_id: sessionId })
    .whereNull("section_id")
    .select(
      "total_questions", "answered_questions", "correct_count",
      "incorrect_count", "unanswered_count", "accuracy",
      "completion_rate", "mean_latency_ms", "min_latency_ms",
      "max_latency_ms", "latency_std_ms"
    )
    .first();

  const sectionRows = await dbOrTrx("session_results as sr")
    .join("sections as s", "sr.section_id", "s.id")
    .where("sr.session_id", sessionId)
    .whereNotNull("sr.section_id")
    .orderBy("s.slug")
    .select(
      "s.id as section_id", "s.slug", "s.name",
      "sr.total_questions", "sr.answered_questions", "sr.correct_count",
      "sr.incorrect_count", "sr.unanswered_count", "sr.accuracy",
      "sr.completion_rate", "sr.mean_latency_ms", "sr.min_latency_ms",
      "sr.max_latency_ms", "sr.latency_std_ms"
    );

  const sessionRow = await dbOrTrx("sessions")
    .where({ id: sessionId })
    .select("patient_id", "created_at", "started_at", "completed_at", "patient_reported_mood")
    .first();

  // Duración: sólo se calcula si ambas timestamps existen y son coherentes.
  let durationSeconds = null;
  if (sessionRow?.started_at && sessionRow?.completed_at) {
    const start = new Date(sessionRow.started_at).getTime();
    const end = new Date(sessionRow.completed_at).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      durationSeconds = Math.round((end - start) / 1000);
    }
  }

  // Dominios cognitivos asignados a las preguntas usadas en esta sesión,
  // agrupados por sección. Query única con joins:
  const sectionIds = sectionRows.map((r) => r.section_id);
  const domainsBySectionId = new Map(sectionIds.map((id) => [id, new Set()]));
  if (sectionIds.length > 0) {
    const domainRows = await dbOrTrx("session_questions as sq")
      .join("session_sections as ss", "sq.session_section_id", "ss.id")
      .join(
        "question_cognitive_domains as qcd",
        "qcd.question_id",
        "sq.question_id"
      )
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .where("ss.session_id", sessionId)
      .whereIn("ss.section_id", sectionIds)
      .distinct("ss.section_id as section_id", "cd.slug as slug");
    for (const dr of domainRows) {
      const set = domainsBySectionId.get(dr.section_id);
      if (set) set.add(dr.slug);
    }
  }

  const sections = sectionRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    cognitive_domain_slugs: [...(domainsBySectionId.get(r.section_id) || [])],
    result: {
      total_questions: r.total_questions,
      answered_questions: r.answered_questions,
      correct_count: r.correct_count,
      incorrect_count: r.incorrect_count,
      unanswered_count: r.unanswered_count,
      accuracy: r.accuracy,
      completion_rate: r.completion_rate,
      mean_latency_ms: r.mean_latency_ms,
      min_latency_ms: r.min_latency_ms,
      max_latency_ms: r.max_latency_ms,
      latency_std_ms: r.latency_std_ms,
    },
  }));

  // v2 — historial longitudinal. Carga hasta HISTORICAL_SESSION_LIMIT sesiones
  // completadas anteriores a la actual, del MISMO paciente. Se usa como contexto
  // comparativo para que el modelo pueda describir cambios observables (REGLA 6
  // del prompt). Si no hay patient_id (defensa contra sesión malformada), no
  // hay previas, o ninguna es comparable con la sesión actual, previousSessions
  // queda [] y el contextBuilder omite el bloque del output (y por tanto el
  // modelo no debe emitir `comparison`).
  //
  // La COMPARABILIDAD se decide en código, no en el modelo: una previa es
  // comparable si comparte al menos una section_slug o un cognitive_domain_slug
  // con la sesión actual (ver filterComparableSessions). Esto evita las
  // contradicciones observadas del tipo "no hay comparables ... hubo mejora".
  let previousSessions = [];
  if (Number.isInteger(sessionRow?.patient_id) && sessionRow?.created_at) {
    const raw = await loadPreviousSessions(dbOrTrx, {
      patientId: sessionRow.patient_id,
      beforeCreatedAt: sessionRow.created_at,
      limit: HISTORICAL_SESSION_LIMIT,
    });
    const currentCreatedMs = new Date(sessionRow.created_at).getTime();
    // Firma de comparabilidad de la sesión actual.
    const currentSectionSlugs = sections.map((s) => s.slug);
    const currentDomainSlugs = Array.from(
      new Set(sections.flatMap((s) => s.cognitive_domain_slugs || []))
    );
    const comparable = filterComparableSessions(raw, {
      section_slugs: currentSectionSlugs,
      cognitive_domain_slugs: currentDomainSlugs,
    });
    previousSessions = comparable.map((p) => {
      let daysBefore;
      if (p.created_at) {
        const prevMs = new Date(p.created_at).getTime();
        if (Number.isFinite(prevMs) && Number.isFinite(currentCreatedMs) && currentCreatedMs >= prevMs) {
          daysBefore = Math.round((currentCreatedMs - prevMs) / (24 * 60 * 60 * 1000));
        }
      }
      return {
        global_metrics: p.global_metrics,
        section_slugs: p.section_slugs,
        cognitive_domain_slugs: p.cognitive_domain_slugs,
        duration_seconds: p.duration_seconds,
        ...(daysBefore !== undefined ? { days_before: daysBefore } : {}),
      };
    });
  }

  // v2.4 (BUG-11): comparison_metrics determinístico. El backend compara contra
  // la previa comparable más reciente (misma section_slug). Si no hay previa
  // de la misma actividad, no se emite — el modelo no debe inventar comparación.
  let comparisonMetrics = null;
  if (previousSessions.length > 0 && sections.length > 0) {
    comparisonMetrics = buildComparisonMetrics({
      currentGlobal: globalRow,
      comparableSessions: previousSessions,
      sectionSlug: sections[0].slug,
    });
  }

  return {
    session: {
      duration_seconds: durationSeconds,
      // Snapshot inmutable persistido en sessions.patient_reported_mood.
      // null si el paciente no autorreportó al crear la sesión. El
      // contextBuilder decidirá si lo emite al modelo o lo omite.
      patient_reported_mood: sessionRow?.patient_reported_mood ?? null,
    },
    global: globalRow,
    sections,
    previous_sessions: previousSessions,
    ...(comparisonMetrics ? { comparison_metrics: comparisonMetrics } : {}),
  };
}

// ------------------------------------------------------------------
// Service público
// ------------------------------------------------------------------

/**
 * Devuelve el último análisis exitoso de una sesión (para GET). No genera.
 * El caller (route) ya validó ownership.
 */
export async function getLatestSuccessfulAnalysis(sessionId, deps = {}) {
  const repo = deps.repo || defaultRepo;
  const dbHandle = deps.db || db;
  return repo.getLatestSuccessfulAnalysis(dbHandle, sessionId);
}

/**
 * Orquestador principal.
 *
 * @param {object} params
 * @param {number} params.sessionId
 * @param {boolean} [params.force=false]  Si true, ignora caché.
 * @param {object} [deps]  Inyección de dependencias para tests.
 * @returns {Promise<{ source: "cache"|"generated", analysis: object }>}
 * @throws {OllamaClientError|AnalysisValidationError|TypeError}
 */
export async function generateSessionAnalysis(params, deps = {}) {
  const { sessionId, force = false } = params;
  if (!Number.isInteger(sessionId) || sessionId < 1) {
    throw new TypeError("sessionId inválido");
  }

  const dbHandle = deps.db || db;
  const repo = deps.repo || defaultRepo;
  const generateFn = deps.generate || defaultGenerate;
  const loadInputFn = deps.loadSessionAnalysisInput || loadSessionAnalysisInput;
  const cfg = deps.config || getOllamaConfig();
  const withLock = deps.withAnalysisLock || defaultWithAnalysisLock;

  const model = cfg.model;
  const schemaVersion = ANALYSIS_SCHEMA_VERSION;
  const promptVersion = PROMPT_BUILDER_VERSION;

  // 1) Cache lookup rápido (pre-lock): solo para force=false. Evita adquirir
  // el advisory lock cuando ya hay un análisis compatible persistido.
  if (!force) {
    const cached = await repo.findCachedSuccessfulAnalysis(dbHandle, {
      sessionId, model, schemaVersion, promptVersion,
    });
    if (cached) return { source: "cache", analysis: cached };
  }

  // 7J.1B — Serialización por identidad (session_id, model, schema, prompt).
  // El lock es blocking: si otro request está generando el mismo análisis,
  // este espera dentro de PostgreSQL hasta que se libere.
  const requestStartedAt = new Date();
  return await withLock(
    { sessionId, model, schemaVersion, promptVersion },
    () => runGenerationCritical({
      sessionId, force, model, schemaVersion, promptVersion,
      requestStartedAt,
      dbHandle, repo, generateFn, loadInputFn,
    }),
    { db: dbHandle },
  );
}

// Sección crítica bajo advisory lock. Extraída para claridad.
async function runGenerationCritical({
  sessionId, force, model, schemaVersion, promptVersion,
  requestStartedAt,
  dbHandle, repo, generateFn, loadInputFn,
}) {
  // Re-check de caché una vez adquirido el lock.
  // - Si !force: reutilizar cualquier fila ok compatible que exista.
  // - Si force=true: reutilizar SOLO si otro request concurrente persistió
  //   un análisis después de que este request entró al pipeline. Esto evita
  //   dos inferencias innecesarias ante doble-submit de "Regenerar", sin
  //   romper la semántica de force=true para un request aislado.
  if (!force) {
    const cached = await repo.findCachedSuccessfulAnalysis(dbHandle, {
      sessionId, model, schemaVersion, promptVersion,
    });
    if (cached) return { source: "cache", analysis: cached };
  } else {
    const concurrent = await repo.findCachedSuccessfulAnalysisSince(dbHandle, {
      sessionId, model, schemaVersion, promptVersion,
      since: requestStartedAt,
    });
    if (concurrent) return { source: "cache", analysis: concurrent };
  }

  // 7J.2 — Crear fila "generating" ANTES de invocar Ollama. Sirve como
  // marca visible al frontend mientras el pipeline corre.
  const generatingRow = await repo.createGeneratingAnalysis(dbHandle, {
    sessionId, model, schemaVersion, promptVersion,
  });

  // 2) Cargar métricas.
  const input = await loadInputFn(dbHandle, sessionId);
  if (!input.global) {
    // session_results global no existe (sesión sin resultado consolidado).
    await repo.markGeneratingAsFailed(dbHandle, {
      id: generatingRow.id,
      errorCode: toPersistedErrorCode("analysis", "SCHEMA_INVALID"),
      errorMessage: "session_results global ausente",
      latencyMs: null,
    });
    throw new TypeError("session_results (global) ausente para la sesión");
  }
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    await repo.markGeneratingAsFailed(dbHandle, {
      id: generatingRow.id,
      errorCode: toPersistedErrorCode("analysis", "SCHEMA_INVALID"),
      errorMessage: "session_results por sección ausente",
      latencyMs: null,
    });
    throw new TypeError("session_results (por sección) ausente");
  }

  // 3) Context builder.
  const context = buildSessionAnalysisContext(input);
  if (context.schema_version !== CONTEXT_SCHEMA_VERSION) {
    await repo.markGeneratingAsFailed(dbHandle, {
      id: generatingRow.id,
      errorCode: toPersistedErrorCode("analysis", "SCHEMA_INVALID"),
      errorMessage: "context_schema_version inesperado",
      latencyMs: null,
    });
    throw new TypeError("context_schema_version inesperado");
  }

  // 4) Observaciones determinísticas (v3.4) + Prompt builder.
  //    Las observations se calculan ANTES del prompt para alimentarlo y
  //    luego se persisten junto al análisis para que el frontend las
  //    muestre tal cual (sin depender de que el modelo las parafrase bien).
  const deterministic = buildObservations(context);
  const { prompt } = buildSessionAnalysisPrompt(context, { observations: deterministic.observations });

  // 5+6) Ollama + Validador — con un único reintento controlado para
  //      modos conocidos de inestabilidad de llama3.2:3b.
  //
  // Política de reintento (BUG-09):
  // - Como MÁXIMO 2 llamadas a Ollama por fila `generating`.
  // - Reintentamos SÓLO ante dos modos específicos:
  //     (a) SECTIONS_MISMATCH          — modelo confunde secciones históricas
  //                                      con las de la sesión actual.
  //     (b) SCHEMA_INVALID en summary
  //         con info.reason="max_length_exceeded"
  //                                     — modelo escribe un summary más largo
  //                                      que el límite estricto del contrato.
  //   Usamos propiedades estructuradas del error (code, path, info) y no
  //   el texto del mensaje.
  // - Para cualquier otro error de validación (JSON inválido, campo
  //   faltante, tipo incorrecto, unexpected field, mismatch en otro campo)
  //   o error de Ollama (offline/timeout/http) NO reintentamos.
  // - Mismo prompt, mismo contexto, misma fila `generating`. No crea otra.
  // - Si ambos intentos fallan, dejamos la fila en failed con la razón del
  //   SEGUNDO intento (más informativa que la del primero).
  const MAX_ATTEMPTS = 2;
  let validated = null;
  let lastOllamaLatencyMs = null;
  let lastValidationError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let ollamaResponse;
    try {
      ollamaResponse = await generateFn(
        {
          prompt,
          model,
          format: "json",
          options: AI_GENERATE_OPTIONS,
          keepAlive: AI_KEEP_ALIVE,
        },
        // sin fetchImpl: usa fetch nativo en prod; los tests inyectan generateFn.
      );
      lastOllamaLatencyMs = ollamaResponse.latencyMs;
    } catch (err) {
      // Errores de Ollama (offline/timeout/http/missing-model): NO reintentar.
      const persistedCode = toPersistedErrorCode("ollama", err?.code || "OLLAMA_OFFLINE");
      await repo.markGeneratingAsFailed(dbHandle, {
        id: generatingRow.id,
        errorCode: persistedCode,
        errorMessage: err instanceof Error ? err.message : String(err),
        latencyMs: null,
      });
      throw err;
    }

    try {
      validated = parseAndValidateSessionAnalysis(ollamaResponse.text, context);
      lastValidationError = null;
      break; // éxito
    } catch (err) {
      if (!(err instanceof AnalysisValidationError)) {
        throw err;
      }
      lastValidationError = err;
      // Reasons reintenciables (v3): modos conocidos de inestabilidad del 3B
      // bajo el contrato simplificado:
      //   SCHEMA_INVALID path=summary + max_length_exceeded
      //   SCHEMA_INVALID + reason=forbidden_clinical_term
      //   SCHEMA_INVALID + reason=numeric_metric_in_text
      const SEMANTIC_RETRIABLE = new Set([
        "forbidden_clinical_term",
        "numeric_metric_in_text",
        // v3.4: atribución de afirmaciones al profesional / calificaciones
        // evaluativas sobre el paciente ("el profesional observó", etc.).
        "unauthorized_observation_about_actor",
      ]);
      const retriable =
        (err.code === AnalysisValidationCodes.SCHEMA_INVALID
          && err.path === "summary"
          && err.info?.reason === "max_length_exceeded") ||
        (err.code === AnalysisValidationCodes.SCHEMA_INVALID
          && SEMANTIC_RETRIABLE.has(err.info?.reason));
      if (retriable && attempt < MAX_ATTEMPTS) {
        continue;
      }
      // No más reintentos: persistir failed con la última razón y propagar.
      const persistedCode = toPersistedErrorCode("analysis", err.code);
      await repo.markGeneratingAsFailed(dbHandle, {
        id: generatingRow.id,
        errorCode: persistedCode,
        errorMessage: err.message,
        latencyMs: lastOllamaLatencyMs,
      });
      throw err;
    }
  }

  // (Si llegamos acá sin validated, el loop ya habría arrojado.)
  if (!validated) {
    // Guardia defensiva — nunca debería ocurrir.
    throw lastValidationError || new Error("Validación de análisis fallida sin razón registrada");
  }
  const ollamaLatencyMs = lastOllamaLatencyMs;

  // 7) v3 — datos determinísticos del backend que acompañan al output del
  // modelo. El modelo sólo genera summary + aspects_to_review; TODO lo demás
  // (actividades, dominios, métricas, mood, comparaciones) lo expone el
  // backend aquí para que la UI las renderice directamente.
  const evidence = buildEvidenceFromContext(context);
  // Lista de actividades reales de la sesión + dominios cognitivos trabajados
  // por cada una. Sirve al frontend para renderizar "Actividades" y "Dominios"
  // sin depender de que el modelo los nombre.
  const activities = context.sections.map((s) => ({
    slug: s.slug,
    name: s.name,
    cognitive_domain_slugs: Array.isArray(s.cognitive_domain_slugs)
      ? [...s.cognitive_domain_slugs]
      : [],
  }));
  const persistable = {
    ...validated,
    activities,
    evidence,
    ...(context.comparison_metrics ? { comparison_metrics: context.comparison_metrics } : {}),
    // v3.4 — observaciones y aspectos orientativos determinísticos.
    // Fuente de verdad para el bloque "Observaciones para seguimiento"
    // del panel; el summary del modelo las parafrasea.
    observations: deterministic.observations,
    follow_up: deterministic.follow_up,
  };

  // 8) Persistencia OK: promocionar fila generating → ok.
  const row = await repo.markGeneratingAsOk(dbHandle, {
    id: generatingRow.id,
    analysis: persistable,
    latencyMs: ollamaLatencyMs,
  });
  return { source: "generated", analysis: row };
}

// Re-exports útiles para la route.
export {
  OllamaClientError,
  AnalysisValidationError,
};
