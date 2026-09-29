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
import { AnalysisValidationError } from "./validationErrors.js";
import { toPersistedErrorCode } from "./errorMapping.js";
import * as defaultRepo from "./analysisRepository.js";
import { withAnalysisLock as defaultWithAnalysisLock } from "./analysisLock.js";

// Parámetros de inferencia. num_predict: cota superior de tokens generados.
// 7J.1A — experimental: bajado de 600 a 500 tras medir que analysis 230
// (schema v1 con 1 sección + 14 evidence + summary ≤400 chars) generó
// ~415 tokens. 500 deja ~85 tokens de holgura sin acercarse al límite,
// y ahorra ~1 s de generación en CPU. Si a la primera generación E2E con
// prompt 1.2 se detecta truncamiento, volver a 600.
export const AI_GENERATE_OPTIONS = Object.freeze({
  temperature: 0.2,
  num_predict: 500,
});

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
    .select("started_at", "completed_at")
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

  return {
    session: { duration_seconds: durationSeconds },
    global: globalRow,
    sections,
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

  // 4) Prompt builder.
  const { prompt } = buildSessionAnalysisPrompt(context);

  // 5) Ollama. Retenemos latencia y errores tipados para pasar a failed.
  let ollamaResponse;
  let ollamaLatencyMs;
  try {
    ollamaResponse = await generateFn(
      {
        prompt,
        model,
        format: "json",
        options: AI_GENERATE_OPTIONS,
      },
      // sin fetchImpl: usa fetch nativo en prod; los tests inyectan generateFn.
    );
    ollamaLatencyMs = ollamaResponse.latencyMs;
  } catch (err) {
    const persistedCode = toPersistedErrorCode("ollama", err?.code || "OLLAMA_OFFLINE");
    await repo.markGeneratingAsFailed(dbHandle, {
      id: generatingRow.id,
      errorCode: persistedCode,
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs: null,
    });
    throw err;
  }

  // 6) Validador. Si falla, marcar failed CONSERVANDO latencia.
  let validated;
  try {
    validated = parseAndValidateSessionAnalysis(ollamaResponse.text, context);
  } catch (err) {
    if (err instanceof AnalysisValidationError) {
      const persistedCode = toPersistedErrorCode("analysis", err.code);
      await repo.markGeneratingAsFailed(dbHandle, {
        id: generatingRow.id,
        errorCode: persistedCode,
        errorMessage: err.message,
        latencyMs: ollamaLatencyMs,
      });
    }
    throw err;
  }

  // 7) Persistencia OK: promocionar fila generating → ok.
  const row = await repo.markGeneratingAsOk(dbHandle, {
    id: generatingRow.id,
    analysis: validated,
    latencyMs: ollamaLatencyMs,
  });
  return { source: "generated", analysis: row };
}

// Re-exports útiles para la route.
export {
  OllamaClientError,
  AnalysisValidationError,
};
