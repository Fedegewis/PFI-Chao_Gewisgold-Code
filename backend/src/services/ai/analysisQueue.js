// W-2: cola persistente de análisis para el worker local.
//
// La cola es DERIVADA, no una tabla propia: se calcula sobre sessions +
// session_analyses. Una sesión es elegible cuando:
//   - sessions.status = 'completed';
//   - NO existe un session_analyses con status='ok' para la triple actual
//     (model, schema_version, prompt_version);
//   - NO existe un session_analyses con status='generating' y lease vivo
//     (lease_expires_at > NOW()) — es decir, nadie la está procesando ya;
//   - no se agotaron los MAX_ATTEMPTS de intentos fallidos para la triple;
//   - no está en cooldown post-fallo (el último failed fue hace > COOLDOWN).
//
// Orden FIFO por sessions.completed_at ASC. Sin filtrar por profesional:
// la cola es global al servidor.
//
// Reutiliza:
//   - contextBuilder → buildSessionAnalysisContext
//   - promptBuilder → buildSessionAnalysisPrompt v3.5
//   - observationsBuilder → observaciones determinísticas
//   - responseValidator → parseAndValidateSessionAnalysis
//   - analysisService.loadSessionAnalysisInput → carga desde DB
//   - evidenceBuilder / comparisonBuilder → inyectados al persistir
//
// No modifica el flujo in-process actual (sessions.js /complete sigue
// disparando setImmediate(generateSessionAnalysis) sin cambios).

import crypto from "node:crypto";
import db from "../../db/connection.js";
import { loadSessionAnalysisInput } from "./analysisService.js";
import { buildSessionAnalysisContext, CONTEXT_SCHEMA_VERSION } from "./contextBuilder.js";
import { buildSessionAnalysisPrompt, PROMPT_BUILDER_VERSION } from "./promptBuilder.js";
import { buildObservations } from "./observationsBuilder.js";
import { buildEvidenceFromContext } from "./evidenceBuilder.js";
import {
  parseAndValidateSessionAnalysis,
  ANALYSIS_SCHEMA_VERSION,
} from "./responseValidator.js";
import { AnalysisValidationError, AnalysisValidationCodes } from "./validationErrors.js";
import { GENERATION_VALIDATION_OPTIONS, RETRIABLE_SEMANTIC_REASONS, formatValidationFailure } from "./contentSafety.js";
import { toPersistedErrorCode } from "./errorMapping.js";

// ------------------------------------------------------------------
// Parámetros de política. Todos sobreescribibles por env para que la
// operación productiva pueda ajustar sin redeploy de código.
// ------------------------------------------------------------------

export const DEFAULTS = Object.freeze({
  // Duración del lease emitido al worker. Debe cubrir cold start + inferencia
  // del 3B en CPU (60–120 s). 5 min deja margen; renovable vía heartbeat.
  LEASE_DURATION_MS: 5 * 60 * 1000,
  // Máximo de intentos fallidos POR CATEGORÍA de error antes de que la sesión
  // salga de la cola. Separar transient vs generación evita que un corte
  // de red o un apagón del dev agote la cuota de intentos "reales".
  MAX_GENERATION_ATTEMPTS: 3,
  MAX_TRANSIENT_ATTEMPTS: 20,
  // Tiempo mínimo entre reintentos tras un failed.
  RETRY_COOLDOWN_MS: 30 * 1000,
  // Modelo "actual" para la triple de la cola.
  MODEL: "llama3.2:3b",
  // W-3: concurrencia global máxima de leases activos sobre toda la
  // instalación. Default 1 porque Ollama en CPU no debería recibir dos
  // inferencias en paralelo (saturan la CPU y multiplican latencias).
  // Si dos procesos worker arrancan por accidente, el backend sólo emitirá
  // UN claim vivo a la vez; el segundo worker recibirá 204 hasta que el
  // primero termine. Subir sólo si la instalación tiene GPU dedicada y
  // se validó experimentalmente.
  GLOBAL_CONCURRENCY: 1,
  // Auditoría 2026-11-04: si es false (default), la cola NO toma sesiones
  // que ya tienen un análisis ok de una versión anterior del prompt/schema/
  // modelo. Evita que un cambio de PROMPT_VERSION regenere automáticamente
  // todo el historial al desplegar. La regeneración de análisis históricos
  // es explícita y controlada (scripts/regenerate-analyses.js).
  REGENERATE_OUTDATED: false,
});

// Clasificación de códigos persistidos en session_analyses.error_code.
//
// TRANSIENT = fallas de infraestructura (red, timeout, Ollama caído,
//   lease vencido sin reporte, modelo no instalado, headers mal formados).
//   Son reintentables sin "costar" cupo de generación: el entorno puede
//   volverse sano y el análisis todavía sirve. Tienen un cap defensivo
//   (MAX_TRANSIENT_ATTEMPTS) sólo para que un entorno terminalmente
//   roto no acumule miles de filas.
//
// GENERATION = el modelo respondió pero su salida no cumple el contrato
//   (JSON inválido, campos extra, términos clínicos, longitud excedida,
//   etc). Reintentar probablemente devuelve el mismo tipo de error, así
//   que se corta a MAX_GENERATION_ATTEMPTS para evitar bucles.
export const TRANSIENT_ERROR_CODES = Object.freeze(new Set([
  "OLLAMA_OFFLINE",
  "OLLAMA_TIMEOUT",
  "OLLAMA_HTTP_ERROR",       // 5xx típicamente transitorio
  "OLLAMA_EMPTY_RESPONSE",   // tratado como transitorio (cold-start raro)
  "OLLAMA_MODEL_NOT_FOUND",  // tratado como transitorio: fixing env lo cura
  "OLLAMA_CONFIG_INVALID",   // idem
  "ANALYSIS_LEASE_EXPIRED",  // worker crasheó o apagó la PC a mitad
]));

export const GENERATION_ERROR_CODES = Object.freeze(new Set([
  "OLLAMA_INVALID_JSON",
  "ANALYSIS_INVALID_JSON",
  "ANALYSIS_SCHEMA_INVALID",
  "ANALYSIS_UNEXPECTED_FIELD",
  "ANALYSIS_SECTIONS_MISMATCH",
  "ANALYSIS_EVIDENCE_INVALID",
]));

function readConfig() {
  const parseIntPositive = (raw, fallback) => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  // Cooldown admite 0 explícito (útil en tests para no esperar). Para los
  // caps, 0 no tiene sentido operativo (equivale a "nunca reclamar").
  const parseIntNonNeg = (raw, fallback) => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  // Compat: WORKER_MAX_ATTEMPTS legacy mapea a MAX_GENERATION_ATTEMPTS
  // cuando no se define el nuevo nombre. Preserva comportamiento histórico
  // de los tests y de documentación previa.
  const legacyMax = parseIntPositive(process.env.WORKER_MAX_ATTEMPTS, null);
  return {
    LEASE_DURATION_MS: parseIntPositive(process.env.WORKER_LEASE_MS, DEFAULTS.LEASE_DURATION_MS),
    MAX_GENERATION_ATTEMPTS: parseIntPositive(
      process.env.WORKER_MAX_GENERATION_ATTEMPTS,
      legacyMax ?? DEFAULTS.MAX_GENERATION_ATTEMPTS,
    ),
    MAX_TRANSIENT_ATTEMPTS: parseIntPositive(
      process.env.WORKER_MAX_TRANSIENT_ATTEMPTS,
      DEFAULTS.MAX_TRANSIENT_ATTEMPTS,
    ),
    RETRY_COOLDOWN_MS: parseIntNonNeg(process.env.WORKER_RETRY_COOLDOWN_MS, DEFAULTS.RETRY_COOLDOWN_MS),
    MODEL: process.env.WORKER_MODEL || process.env.OLLAMA_MODEL || DEFAULTS.MODEL,
    GLOBAL_CONCURRENCY: parseIntPositive(
      process.env.WORKER_GLOBAL_CONCURRENCY,
      DEFAULTS.GLOBAL_CONCURRENCY,
    ),
    REGENERATE_OUTDATED: process.env.WORKER_REGENERATE_OUTDATED_ANALYSES === "true",
  };
}

export function getQueueConfig() {
  return readConfig();
}

// Expuesto como helper para la query de pendientes y para tests.
export function classifyErrorCode(code) {
  if (TRANSIENT_ERROR_CODES.has(code)) return "transient";
  if (GENERATION_ERROR_CODES.has(code)) return "generation";
  return "unknown";
}

// ------------------------------------------------------------------
// Advisory lock por sesión. Se toma dentro de una transacción con
// pg_try_advisory_xact_lock para que si dos workers compiten por la misma
// sesión, uno gane y el otro reciba 204 "no hay trabajo" y repolle.
// ------------------------------------------------------------------

function sessionLockKeys(sessionId, model, schemaVersion, promptVersion) {
  // Alineado con analysisLock.buildAnalysisLockKey: key1=sessionId,
  // key2=hash(model+schema+prompt) truncado a int32 con signo.
  const composite = `model=${model}|schema=${schemaVersion}|prompt=${promptVersion}`;
  const digest = crypto.createHash("sha256").update(composite).digest();
  return { key1: sessionId, key2: digest.readInt32BE(0) };
}

// Clave reservada del advisory lock GLOBAL de la cola de claims.
// key1 = 0 nunca colisiona con sessionLockKeys porque sessions.id es
// SERIAL (>= 1). key2 = hash determinístico de un string reservado para
// que, aunque alguien use key1=0 por error en otra parte, el par completo
// sea estadísticamente único al espacio de 32 bits.
const GLOBAL_CLAIM_LOCK_KEY1 = 0;
const GLOBAL_CLAIM_LOCK_KEY2 = crypto
  .createHash("sha256")
  .update("menteactiva-worker-global-claim-v1")
  .digest()
  .readInt32BE(0);

// ------------------------------------------------------------------
// Query de pendientes (FIFO). Devuelve el id de la primera sesión
// candidata, o null. No toma el lock; eso lo hace claimNextSession.
// ------------------------------------------------------------------

async function findNextPendingSessionId(
  dbOrTrx,
  { model, schemaVersion, promptVersion, maxGenerationAttempts, maxTransientAttempts, cooldownMs, regenerateOutdated = false }
) {
  const transientCodes = [...TRANSIENT_ERROR_CODES];
  const generationCodes = [...GENERATION_ERROR_CODES];
  const query = dbOrTrx("sessions as s")
    .where("s.status", "completed")
    .whereNotExists((qb) =>
      qb.from("session_analyses as sa_ok")
        .select(1)
        .whereRaw("sa_ok.session_id = s.id")
        .andWhere("sa_ok.status", "ok")
        .andWhere("sa_ok.model", model)
        .andWhere("sa_ok.schema_version", schemaVersion)
        .andWhere("sa_ok.prompt_version", promptVersion)
    )
    .whereNotExists((qb) =>
      qb.from("session_analyses as sa_g")
        .select(1)
        .whereRaw("sa_g.session_id = s.id")
        .andWhere("sa_g.status", "generating")
        .andWhereRaw("sa_g.lease_expires_at > NOW()")
    )
    // Reintentos de generación: cap estricto para evitar bucles.
    .whereRaw(
      "(SELECT COUNT(*) FROM session_analyses sa_f " +
      "WHERE sa_f.session_id = s.id AND sa_f.model = ? AND sa_f.schema_version = ? AND sa_f.prompt_version = ? " +
      `AND sa_f.status = 'failed' AND sa_f.error_code IN (${generationCodes.map(() => "?").join(",")})) < ?`,
      [model, schemaVersion, promptVersion, ...generationCodes, maxGenerationAttempts]
    )
    // Reintentos transitorios: cap defensivo mucho más alto.
    .whereRaw(
      "(SELECT COUNT(*) FROM session_analyses sa_f " +
      "WHERE sa_f.session_id = s.id AND sa_f.model = ? AND sa_f.schema_version = ? AND sa_f.prompt_version = ? " +
      `AND sa_f.status = 'failed' AND sa_f.error_code IN (${transientCodes.map(() => "?").join(",")})) < ?`,
      [model, schemaVersion, promptVersion, ...transientCodes, maxTransientAttempts]
    )
    // Cooldown post-fallo (indistinto de categoría).
    .whereRaw(
      "NOT EXISTS (SELECT 1 FROM session_analyses sa_c " +
      "WHERE sa_c.session_id = s.id AND sa_c.model = ? AND sa_c.schema_version = ? AND sa_c.prompt_version = ? " +
      "AND sa_c.status = 'failed' " +
      `AND sa_c.created_at > NOW() - INTERVAL '${Number(cooldownMs)} milliseconds')`,
      [model, schemaVersion, promptVersion]
    )
    .orderBy("s.completed_at", "asc")
    .select("s.id as session_id", "s.completed_at");
  if (!regenerateOutdated) {
    // Sólo sesiones sin NINGÚN análisis ok (de cualquier versión).
    query.whereNotExists((qb) =>
      qb.from("session_analyses as sa_any")
        .select(1)
        .whereRaw("sa_any.session_id = s.id")
        .andWhere("sa_any.status", "ok")
    );
  }
  const row = await query.first();
  return row || null;
}

// Reaper lazy: materializa como failed(ANALYSIS_LEASE_EXPIRED) las filas
// generating cuyo lease ya venció. Mantiene el historial legible y permite
// contabilidad por categoría. No bloquea el claim si no actualiza nada
// (son filas que la query de pendientes ya ignora via lease_expires_at).
async function reapExpiredLeases(dbOrTrx) {
  await dbOrTrx("session_analyses")
    .where("status", "generating")
    .andWhere("lease_expires_at", "<", dbOrTrx.fn.now())
    .update({
      status: "failed",
      error_code: "ANALYSIS_LEASE_EXPIRED",
      error_message: "Lease vencido sin reporte del worker",
      lease_expires_at: null,
      claim_token: null,
    });
}

// ------------------------------------------------------------------
// claimNextSession — exportado para la route /api/worker/analysis/claim.
//
// Toma UNA sesión pendiente (o ninguna). Transaccional. Dos workers
// simultáneos no pueden reclamar la misma sesión gracias al advisory
// try_lock por sesión + la verificación de "no hay generating activo".
//
// Devuelve, en caso de éxito, el payload que el worker necesita para
// correr Ollama: claim_id, claim_token, prompt, model, schema_version,
// prompt_version. NO expone context ni evidence ni PII.
// Si no hay trabajo, devuelve null.
// ------------------------------------------------------------------

export async function claimNextSession(deps = {}) {
  const dbHandle = deps.db || db;
  const cfg = { ...readConfig(), ...(deps.configOverrides || {}) };
  const schemaVersion = ANALYSIS_SCHEMA_VERSION;
  const promptVersion = PROMPT_BUILDER_VERSION;
  const model = cfg.MODEL;

  // Reaper lazy: materializar leases vencidos como failed(LEASE_EXPIRED)
  // antes de buscar candidata. Hace la cola idempotente ante crashes del
  // worker y mantiene historial auditable. Fuera de la transacción del
  // claim para que un UPDATE grande no bloquee la toma de la próxima.
  await reapExpiredLeases(dbHandle);

  return await dbHandle.transaction(async (trx) => {
    // W-3-FIX: advisory lock GLOBAL transaccional ANTES de todo lo demás.
    //
    // Problema que corrige: con read-committed, dos transacciones concurrentes
    // podrían leer `COUNT(generating activo) = 0` al mismo tiempo y cada una
    // emitir su propio claim sobre sesiones distintas, violando
    // WORKER_GLOBAL_CONCURRENCY=1. El advisory lock serializa la "zona
    // crítica de emisión de claims": sólo UNA transacción puede evaluar y
    // emitir claim a la vez.
    //
    // Semántica:
    //   - pg_try_advisory_xact_lock devuelve false si otra tx ya lo tiene →
    //     devolvemos null (204 al worker). El worker reintenta en su
    //     próximo poll (requisito 4 del pedido: "responder 204 … sin crear
    //     un segundo claim").
    //   - El lock se libera automáticamente al cerrar la transacción, sin
    //     necesidad de unlock explícito.
    //   - Como todo el trabajo del claim es rápido (ms), el lock bloquea muy
    //     poco tiempo. La inferencia Ollama (segundos–minutos) ya ocurre
    //     FUERA del lock, en el worker.
    //
    // El advisory lock por sesión (más abajo) se MANTIENE: es defensa en
    // profundidad por si alguien cambia GLOBAL_CONCURRENCY > 1 en el futuro,
    // y además protege el escenario de un solo nodo backend con workers
    // rápidos consecutivos.
    const globalLockRes = await trx.raw(
      "SELECT pg_try_advisory_xact_lock(?, ?) AS got",
      [GLOBAL_CLAIM_LOCK_KEY1, GLOBAL_CLAIM_LOCK_KEY2],
    );
    const gotGlobalLock = globalLockRes.rows?.[0]?.got === true;
    if (!gotGlobalLock) return null;

    // Bajo el lock global: COUNT de leases activos y comparación contra
    // GLOBAL_CONCURRENCY. Es consistente ahora porque ninguna otra tx
    // puede estar emitiendo claim en este instante.
    const liveLeases = await trx("session_analyses")
      .where("status", "generating")
      .andWhere("lease_expires_at", ">", trx.fn.now())
      .count("id as c")
      .first();
    const liveCount = Number(liveLeases?.c || 0);
    if (liveCount >= cfg.GLOBAL_CONCURRENCY) return null;

    const candidate = await findNextPendingSessionId(trx, {
      model, schemaVersion, promptVersion,
      maxGenerationAttempts: cfg.MAX_GENERATION_ATTEMPTS,
      maxTransientAttempts: cfg.MAX_TRANSIENT_ATTEMPTS,
      cooldownMs: cfg.RETRY_COOLDOWN_MS,
      regenerateOutdated: cfg.REGENERATE_OUTDATED === true,
    });
    if (!candidate) return null;

    const { key1, key2 } = sessionLockKeys(candidate.session_id, model, schemaVersion, promptVersion);
    const lockRes = await trx.raw("SELECT pg_try_advisory_xact_lock(?, ?) AS got", [key1, key2]);
    const gotLock = lockRes.rows?.[0]?.got === true;
    if (!gotLock) return null;

    // Dentro del lock: re-verificar que la sesión sigue siendo elegible
    // (otra tx pudo haber insertado un generating activo justo antes).
    const stillPending = await trx("session_analyses")
      .where({ session_id: candidate.session_id, status: "generating" })
      .andWhere("lease_expires_at", ">", trx.fn.now())
      .first();
    if (stillPending) return null;

    // Contador observacional: cuántos intentos previos hubo para esta
    // triple (ok + failed + generating).
    const priorRow = await trx("session_analyses")
      .where({
        session_id: candidate.session_id,
        model, schema_version: schemaVersion, prompt_version: promptVersion,
      })
      .count("id as c")
      .first();
    const priorAttempts = Number(priorRow?.c || 0);

    // Cargar métricas y construir contexto + prompt. Si el backend no puede
    // construir el input (sesión mal formada), degradar a failed y seguir.
    let input;
    try {
      input = await loadSessionAnalysisInput(trx, candidate.session_id);
    } catch (err) {
      await trx("session_analyses").insert({
        session_id: candidate.session_id,
        status: "failed",
        model, schema_version: schemaVersion, prompt_version: promptVersion,
        error_code: "ANALYSIS_SCHEMA_INVALID",
        error_message: `Fallo al cargar input: ${err?.message || String(err)}`.slice(0, 500),
        attempt_count: priorAttempts,
      });
      return null;
    }
    if (!input.global || !Array.isArray(input.sections) || input.sections.length === 0) {
      await trx("session_analyses").insert({
        session_id: candidate.session_id,
        status: "failed",
        model, schema_version: schemaVersion, prompt_version: promptVersion,
        error_code: "ANALYSIS_SCHEMA_INVALID",
        error_message: "session_results ausente al reclamar",
        attempt_count: priorAttempts,
      });
      return null;
    }

    const context = buildSessionAnalysisContext(input);
    if (context.schema_version !== CONTEXT_SCHEMA_VERSION) {
      await trx("session_analyses").insert({
        session_id: candidate.session_id,
        status: "failed",
        model, schema_version: schemaVersion, prompt_version: promptVersion,
        error_code: "ANALYSIS_SCHEMA_INVALID",
        error_message: "context_schema_version inesperado",
        attempt_count: priorAttempts,
      });
      return null;
    }
    const deterministic = buildObservations(context);
    const { prompt } = buildSessionAnalysisPrompt(context, { observations: deterministic.observations });

    // Emitir claim: fila generating con lease + claim_token.
    const claimToken = crypto.randomBytes(16).toString("hex");
    const leaseExpiresAt = new Date(Date.now() + cfg.LEASE_DURATION_MS);

    const [created] = await trx("session_analyses")
      .insert({
        session_id: candidate.session_id,
        status: "generating",
        model, schema_version: schemaVersion, prompt_version: promptVersion,
        lease_expires_at: leaseExpiresAt,
        claim_token: claimToken,
        attempt_count: priorAttempts,
      })
      .returning(["id", "session_id", "model", "schema_version", "prompt_version", "lease_expires_at"]);

    return {
      claim_id: created.id,
      claim_token: claimToken,
      session_id: created.session_id,
      model: created.model,
      schema_version: created.schema_version,
      prompt_version: created.prompt_version,
      lease_expires_at: created.lease_expires_at,
      prompt,
    };
  });
}

// ------------------------------------------------------------------
// submitResult — invocado por POST /api/worker/analysis/result.
//
// Verifica propiedad vigente (claim_token + lease no expirado + status
// aún en generating) mediante un UPDATE condicional. Si no hay fila
// coincidente, el claim fue perdido (expiró o fue sobrescrito) y se
// rechaza con 409.
//
// En éxito: valida JSON vía responseValidator, inyecta activities +
// evidence + comparison_metrics + observations + follow_up (mismos
// bloques que el flujo in-process), persiste status=ok con analysis.
// ------------------------------------------------------------------

export async function submitResult(params, deps = {}) {
  const { claimId, claimToken, rawText, latencyMs } = params;
  if (!Number.isInteger(claimId) || claimId < 1) {
    const err = new Error("claim_id inválido");
    err.code = "CLAIM_INVALID";
    throw err;
  }
  if (typeof claimToken !== "string" || claimToken.length === 0) {
    const err = new Error("claim_token requerido");
    err.code = "CLAIM_INVALID";
    throw err;
  }
  if (typeof rawText !== "string" || rawText.length === 0) {
    const err = new Error("raw_text requerido");
    err.code = "RESULT_INVALID";
    throw err;
  }
  const latency = Number.isInteger(latencyMs) && latencyMs >= 0 ? latencyMs : null;
  const dbHandle = deps.db || db;

  // Fase 1 (transaccional): verificar propiedad del claim y preparar el
  // contexto determinístico. La fila NO se muta todavía — así, si la
  // validación falla y queremos persistir "failed", no estamos atrapados
  // en una tx que vamos a abortar al throw.
  const ctxPkg = await dbHandle.transaction(async (trx) => {
    const row = await trx("session_analyses")
      .where({ id: claimId, status: "generating", claim_token: claimToken })
      .andWhere("lease_expires_at", ">", trx.fn.now())
      .first();
    if (!row) {
      const err = new Error("Claim no vigente (token, estado o lease)");
      err.code = "CLAIM_LOST";
      throw err;
    }
    const input = await loadSessionAnalysisInput(trx, row.session_id);
    const context = buildSessionAnalysisContext(input);
    const deterministic = buildObservations(context);
    return { context, deterministic, sessionId: row.session_id };
  });

  // Fase 2 (sin tx): validar JSON del modelo.
  let validated;
  try {
    validated = parseAndValidateSessionAnalysis(rawText, ctxPkg.context, {
      observations: ctxPkg.deterministic.observations,
      followUp: ctxPkg.deterministic.follow_up,
      ...GENERATION_VALIDATION_OPTIONS,
    });
  } catch (err) {
    if (!(err instanceof AnalysisValidationError)) throw err;
    const persistedCode = toPersistedErrorCode("analysis", err.code);
    // Compartido con el otro flujo de generación (contentSafety.js).
    const SEMANTIC_RETRIABLE = RETRIABLE_SEMANTIC_REASONS;
    const retriable =
      err.code === AnalysisValidationCodes.SCHEMA_INVALID &&
      ((err.path === "summary" && err.info?.reason === "max_length_exceeded") ||
       SEMANTIC_RETRIABLE.has(err.info?.reason));
    // Persistir failed en una conexión separada (no envuelta en tx que
    // aborte al throw). Si el UPDATE no encuentra la fila, el claim ya
    // había sido cerrado por otro camino — propagamos como CLAIM_LOST.
    const [failedRow] = await dbHandle("session_analyses")
      .where({ id: claimId, status: "generating", claim_token: claimToken })
      .andWhere("lease_expires_at", ">", dbHandle.fn.now())
      .update({
        status: "failed",
        error_code: persistedCode,
        error_message: formatValidationFailure(err).slice(0, 500),
        latency_ms: latency,
        analysis: null,
        lease_expires_at: null,
        claim_token: null,
      })
      .returning("*");
    if (!failedRow) {
      const lost = new Error("Claim no vigente al persistir failed");
      lost.code = "CLAIM_LOST";
      throw lost;
    }
    const out = new Error(err.message);
    out.code = "VALIDATION_FAILED";
    out.info = { validation_code: err.code, retriable };
    throw out;
  }

  // Fase 3: inyectar bloques determinísticos y persistir OK.
  const evidence = buildEvidenceFromContext(ctxPkg.context);
  const activities = ctxPkg.context.sections.map((s) => ({
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
    ...(ctxPkg.context.comparison_metrics ? { comparison_metrics: ctxPkg.context.comparison_metrics } : {}),
    observations: ctxPkg.deterministic.observations,
    follow_up: ctxPkg.deterministic.follow_up,
  };

  const [updated] = await dbHandle("session_analyses")
    .where({ id: claimId, status: "generating", claim_token: claimToken })
    .andWhere("lease_expires_at", ">", dbHandle.fn.now())
    .update({
      status: "ok",
      analysis: persistable,
      latency_ms: latency,
      error_code: null,
      error_message: null,
      lease_expires_at: null,
      claim_token: null,
    })
    .returning("*");
  if (!updated) {
    const err = new Error("El lease expiró mientras se validaba el resultado");
    err.code = "CLAIM_LOST";
    throw err;
  }
  return updated;
}

// ------------------------------------------------------------------
// submitFailed — invocado por POST /api/worker/analysis/failed.
//
// El worker reporta que Ollama o la red falló. Backend persiste failed
// con el error_code reportado (debe estar en la whitelist OLLAMA_*).
// ------------------------------------------------------------------

const WORKER_ALLOWED_ERROR_CODES = new Set([
  "OLLAMA_OFFLINE",
  "OLLAMA_TIMEOUT",
  "OLLAMA_HTTP_ERROR",
  "OLLAMA_MODEL_NOT_FOUND",
  "OLLAMA_EMPTY_RESPONSE",
  "OLLAMA_INVALID_JSON",
  "OLLAMA_CONFIG_INVALID",
]);

export function isWorkerAllowedErrorCode(code) {
  return WORKER_ALLOWED_ERROR_CODES.has(code);
}

export async function submitFailed(params, deps = {}) {
  const { claimId, claimToken, errorCode, errorMessage, latencyMs } = params;
  if (!Number.isInteger(claimId) || claimId < 1) {
    const err = new Error("claim_id inválido");
    err.code = "CLAIM_INVALID";
    throw err;
  }
  if (typeof claimToken !== "string" || claimToken.length === 0) {
    const err = new Error("claim_token requerido");
    err.code = "CLAIM_INVALID";
    throw err;
  }
  if (typeof errorCode !== "string" || !WORKER_ALLOWED_ERROR_CODES.has(errorCode)) {
    const err = new Error("error_code no permitido para el worker");
    err.code = "ERROR_CODE_INVALID";
    throw err;
  }
  const latency = Number.isInteger(latencyMs) && latencyMs >= 0 ? latencyMs : null;
  const safeMessage = typeof errorMessage === "string"
    // eslint-disable-next-line no-control-regex
    ? errorMessage.replace(/[\x00-\x1F\x7F]+/g, " ").trim().slice(0, 500)
    : null;
  const dbHandle = deps.db || db;

  const [updated] = await dbHandle("session_analyses")
    .where({ id: claimId, status: "generating", claim_token: claimToken })
    .andWhere("lease_expires_at", ">", dbHandle.fn.now())
    .update({
      status: "failed",
      error_code: errorCode,
      error_message: safeMessage,
      latency_ms: latency,
      analysis: null,
      lease_expires_at: null,
      claim_token: null,
    })
    .returning("*");

  if (!updated) {
    const err = new Error("Claim no vigente al reportar failed");
    err.code = "CLAIM_LOST";
    throw err;
  }
  return updated;
}

// ------------------------------------------------------------------
// renewLease — invocado por POST /api/worker/analysis/heartbeat.
//
// Extiende lease_expires_at de forma atómica con un UPDATE condicional
// que exige: fila sigue en 'generating', claim_token coincide, y el lease
// NO venció todavía. Si el UPDATE afecta 0 filas, el claim ya no es
// vigente — devolvemos CLAIM_LOST. Si lo afecta, el lease arranca de nuevo
// desde NOW() + LEASE_DURATION_MS.
//
// Diseño de seguridad:
//   - El UPDATE no acepta claims con status != 'generating' (nunca
//     reabre análisis ya completados como ok/failed).
//   - El UPDATE no acepta leases vencidos: si el worker se durmió, otro
//     worker pudo haber tomado la sesión; no queremos resucitar al viejo.
//   - El token es la credencial de propiedad: dos workers con el mismo
//     claim_id pero distinto token NO pueden extender el mismo lease.
// ------------------------------------------------------------------

export async function renewLease(params, deps = {}) {
  const { claimId, claimToken } = params;
  if (!Number.isInteger(claimId) || claimId < 1) {
    const err = new Error("claim_id inválido");
    err.code = "CLAIM_INVALID";
    throw err;
  }
  if (typeof claimToken !== "string" || claimToken.length === 0) {
    const err = new Error("claim_token requerido");
    err.code = "CLAIM_INVALID";
    throw err;
  }
  const dbHandle = deps.db || db;
  const cfg = { ...readConfig(), ...(deps.configOverrides || {}) };
  const newLeaseExpiresAt = new Date(Date.now() + cfg.LEASE_DURATION_MS);

  const [updated] = await dbHandle("session_analyses")
    .where({ id: claimId, status: "generating", claim_token: claimToken })
    .andWhere("lease_expires_at", ">", dbHandle.fn.now())
    .update({ lease_expires_at: newLeaseExpiresAt })
    .returning(["id", "session_id", "lease_expires_at"]);

  if (!updated) {
    const err = new Error("Claim no vigente al renovar lease");
    err.code = "CLAIM_LOST";
    throw err;
  }
  return updated;
}

export const QUEUE_LEASE_DURATION_MS = DEFAULTS.LEASE_DURATION_MS;
export const QUEUE_MAX_GENERATION_ATTEMPTS = DEFAULTS.MAX_GENERATION_ATTEMPTS;
export const QUEUE_MAX_TRANSIENT_ATTEMPTS = DEFAULTS.MAX_TRANSIENT_ATTEMPTS;
export const QUEUE_RETRY_COOLDOWN_MS = DEFAULTS.RETRY_COOLDOWN_MS;
