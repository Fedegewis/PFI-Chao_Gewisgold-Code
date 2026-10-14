// 7F: repository de persistencia de session_analyses.
//
// Alcance intencionalmente ACOTADO:
// - No llama Ollama, no construye contexto ni prompt, no valida el output
//   del modelo. Recibe `analysis` ya validado por responseValidator.
// - No conoce req/res ni ownership HTTP (eso vive en 7G).
// - Sí: valida invariantes básicas antes del INSERT.
//
// Contrato:
//   createSuccessfulAnalysis(dbOrTrx, {...}) -> row insertada (parsed)
//   createFailedAnalysis    (dbOrTrx, {...}) -> row insertada (parsed)
//   getAnalysesForSession   (dbOrTrx, sessionId) -> array ordenado desc por created_at
//
// Se acepta `dbOrTrx`: cualquier queryBuilder Knex (conexión o trx activa).
// El caller decide si envolver en transacción.

import { PERSISTED_ERROR_CODES } from "./errorMapping.js";

const ERROR_MESSAGE_MAX = 500;

/**
 * Sanitiza un mensaje de error para persistencia (7F §9).
 * - trunca a ERROR_MESSAGE_MAX chars;
 * - elimina caracteres de control (incluye CR/LF/tabs);
 * - devuelve null si la entrada no aporta información utilizable.
 *
 * Documentado: el CALLER es responsable de no pasar raw output del modelo,
 * prompts, ni contexto completo. Este helper no detecta PII compleja.
 */
export function sanitizeErrorMessage(input) {
  if (input === undefined || input === null) return null;
  const raw = typeof input === "string" ? input : String(input?.message ?? input);
  if (typeof raw !== "string") return null;
  // Reemplazar cualquier control char (incluye \n, \r, \t) por espacio;
  // colapsar espacios repetidos; recortar.
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > ERROR_MESSAGE_MAX
    ? cleaned.slice(0, ERROR_MESSAGE_MAX)
    : cleaned;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.length === 0) {
    throw new TypeError(`${name} debe ser string no vacío`);
  }
}

function assertSessionId(v) {
  if (!Number.isInteger(v) || v < 1) {
    throw new TypeError("session_id debe ser entero positivo");
  }
}

function assertLatencyOrNull(v) {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0) {
    throw new TypeError("latency_ms debe ser entero >= 0 o null");
  }
  return v;
}

function assertValidatedAnalysis(analysis) {
  // Sanidad mínima. La validación semántica es de responseValidator y ya
  // ocurrió aguas arriba. Acá sólo evitamos aceptar cualquier cosa.
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    throw new TypeError("analysis debe ser objeto validado");
  }
  // Aceptamos v1/v2 (persistidos históricamente) y v3 (vigente). El caller
  // elige qué versión persiste; la UI tolera todas al leer.
  const allowed = new Set(["1", "2", "3"]);
  if (!allowed.has(analysis.schema_version)) {
    throw new TypeError("analysis.schema_version inválido: no fue validado por responseValidator");
  }
  if (analysis.schema_version === "3") {
    // Contrato v3: summary (modelo) + aspects_to_review (modelo) + activities
    // + evidence inyectados por analysisService antes de persistir.
    // v3.4 agrega observations + follow_up determinísticos — opcionales
    // en v3.0-3.3 por compat (análisis históricos persistidos sin ellos).
    for (const f of ["summary", "aspects_to_review", "activities", "evidence"]) {
      if (!(f in analysis)) {
        throw new TypeError(`analysis sin campo requerido '${f}' (no fue validado)`);
      }
    }
    return;
  }
  // Campos comunes a v1 y v2.
  for (const f of ["summary", "observations_by_section", "aspects_to_review", "evidence"]) {
    if (!(f in analysis)) {
      throw new TypeError(`analysis sin campo requerido '${f}' (no fue validado)`);
    }
  }
}

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    latency_ms: row.latency_ms == null ? null : Number(row.latency_ms),
  };
}

/**
 * @param {object} dbOrTrx  Knex conexión o transacción.
 * @param {object} params
 * @param {number} params.sessionId
 * @param {string} params.model
 * @param {string} params.schemaVersion   // schema del analysis validado (v1: "1")
 * @param {string} params.promptVersion
 * @param {object} params.analysis        // ya validado
 * @param {number|null} params.latencyMs  // OllamaClientResponse.latencyMs
 */
export async function createSuccessfulAnalysis(dbOrTrx, params) {
  const { sessionId, model, schemaVersion, promptVersion, analysis, latencyMs } = params || {};
  assertSessionId(sessionId);
  assertNonEmptyString(model, "model");
  assertNonEmptyString(schemaVersion, "schema_version");
  assertNonEmptyString(promptVersion, "prompt_version");
  assertValidatedAnalysis(analysis);
  const latency = assertLatencyOrNull(latencyMs);

  const [row] = await dbOrTrx("session_analyses")
    .insert({
      session_id: sessionId,
      status: "ok",
      error_code: null,
      model,
      schema_version: schemaVersion,
      prompt_version: promptVersion,
      analysis, // Knex serializa a JSONB
      latency_ms: latency,
      error_message: null,
    })
    .returning("*");
  return parseRow(row);
}

/**
 * @param {object} dbOrTrx
 * @param {object} params
 * @param {number} params.sessionId
 * @param {string} params.errorCode           // ya normalizado con toPersistedErrorCode()
 * @param {string|null} [params.errorMessage]
 * @param {string|null} [params.model]        // pueden ser null si el fallo fue antes
 * @param {string|null} [params.schemaVersion]
 * @param {string|null} [params.promptVersion]
 * @param {number|null} [params.latencyMs]
 */
export async function createFailedAnalysis(dbOrTrx, params) {
  const {
    sessionId, errorCode, errorMessage,
    model = null, schemaVersion = null, promptVersion = null,
    latencyMs = null,
  } = params || {};
  assertSessionId(sessionId);
  if (typeof errorCode !== "string" || errorCode.length === 0) {
    throw new TypeError("errorCode obligatorio");
  }
  if (!PERSISTED_ERROR_CODES.has(errorCode)) {
    throw new TypeError(
      `errorCode '${errorCode}' no está en la whitelist normalizada (usar toPersistedErrorCode)`
    );
  }
  if (model !== null) assertNonEmptyString(model, "model");
  if (schemaVersion !== null) assertNonEmptyString(schemaVersion, "schema_version");
  if (promptVersion !== null) assertNonEmptyString(promptVersion, "prompt_version");
  const latency = assertLatencyOrNull(latencyMs);
  const sanitizedMessage = sanitizeErrorMessage(errorMessage);

  const [row] = await dbOrTrx("session_analyses")
    .insert({
      session_id: sessionId,
      status: "failed",
      error_code: errorCode,
      model,
      schema_version: schemaVersion,
      prompt_version: promptVersion,
      analysis: null,
      latency_ms: latency,
      error_message: sanitizedMessage,
    })
    .returning("*");
  return parseRow(row);
}

/**
 * Busca el análisis exitoso más reciente de una sesión que coincida
 * exactamente con model + schema_version + prompt_version. Utilizado por
 * el service de 7G para la caché (§5).
 *
 * @param {object} dbOrTrx
 * @param {object} params  { sessionId, model, schemaVersion, promptVersion }
 * @returns {object|null}  row parseada o null.
 */
export async function findCachedSuccessfulAnalysis(dbOrTrx, params) {
  const { sessionId, model, schemaVersion, promptVersion } = params || {};
  assertSessionId(sessionId);
  assertNonEmptyString(model, "model");
  assertNonEmptyString(schemaVersion, "schema_version");
  assertNonEmptyString(promptVersion, "prompt_version");
  const row = await dbOrTrx("session_analyses")
    .where({
      session_id: sessionId,
      status: "ok",
      model,
      schema_version: schemaVersion,
      prompt_version: promptVersion,
    })
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }])
    .first();
  return row ? parseRow(row) : null;
}

/**
 * 7J.1B — Variante para el re-check bajo advisory lock cuando el request
 * usa force=true. Devuelve un análisis exitoso cuyo `created_at >= since`.
 * Sirve para detectar si un request concurrente acabó de persistir el
 * resultado mientras este esperaba el lock, y así evitar una inferencia
 * duplicada. Si no hay fila nueva desde `since`, retorna null.
 */
export async function findCachedSuccessfulAnalysisSince(dbOrTrx, params) {
  const { sessionId, model, schemaVersion, promptVersion, since } = params || {};
  assertSessionId(sessionId);
  assertNonEmptyString(model, "model");
  assertNonEmptyString(schemaVersion, "schema_version");
  assertNonEmptyString(promptVersion, "prompt_version");
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    throw new TypeError("since debe ser una Date válida");
  }
  const row = await dbOrTrx("session_analyses")
    .where({
      session_id: sessionId,
      status: "ok",
      model,
      schema_version: schemaVersion,
      prompt_version: promptVersion,
    })
    .andWhere("created_at", ">=", since)
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }])
    .first();
  return row ? parseRow(row) : null;
}

/**
 * Último análisis exitoso de la sesión, sin filtrar por versión. Utilizado
 * por GET /api/sessions/:id/analysis (§7). Devuelve null si no hay ninguno.
 */
export async function getLatestSuccessfulAnalysis(dbOrTrx, sessionId) {
  assertSessionId(sessionId);
  const row = await dbOrTrx("session_analyses")
    .where({ session_id: sessionId, status: "ok" })
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }])
    .first();
  return row ? parseRow(row) : null;
}

/**
 * 7J.2 — Última fila de session_analyses para la sesión, sin filtrar por
 * status ni por versión. Sirve al endpoint GET para poder distinguir
 * generating vs ok vs failed vs inexistente.
 */
export async function getLatestAnalysisAnyStatus(dbOrTrx, sessionId) {
  assertSessionId(sessionId);
  const row = await dbOrTrx("session_analyses")
    .where({ session_id: sessionId })
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }])
    .first();
  return row ? parseRow(row) : null;
}

/**
 * 7J.2 — Crea una fila con status='generating' que actúa como marca de
 * pipeline en curso. Devuelve la fila (que incluye `id`) para que el service
 * la actualice después con ok/failed. Cumple el CHECK constraint de la
 * migración 012: analysis/error_code/error_message/latency_ms van en null.
 */
export async function createGeneratingAnalysis(dbOrTrx, params) {
  const { sessionId, model, schemaVersion, promptVersion } = params || {};
  assertSessionId(sessionId);
  assertNonEmptyString(model, "model");
  assertNonEmptyString(schemaVersion, "schema_version");
  assertNonEmptyString(promptVersion, "prompt_version");
  const [row] = await dbOrTrx("session_analyses")
    .insert({
      session_id: sessionId,
      status: "generating",
      error_code: null,
      model,
      schema_version: schemaVersion,
      prompt_version: promptVersion,
      analysis: null,
      latency_ms: null,
      error_message: null,
    })
    .returning("*");
  return parseRow(row);
}

/**
 * 7J.2 — Marca la fila generating como ok, cargando analysis + latency.
 */
export async function markGeneratingAsOk(dbOrTrx, params) {
  const { id, analysis, latencyMs } = params || {};
  if (!Number.isInteger(id) || id < 1) throw new TypeError("id inválido");
  assertValidatedAnalysis(analysis);
  const latency = assertLatencyOrNull(latencyMs);
  const [row] = await dbOrTrx("session_analyses")
    .where({ id, status: "generating" })
    .update({
      status: "ok",
      analysis,
      latency_ms: latency,
      error_code: null,
      error_message: null,
    })
    .returning("*");
  if (!row) throw new Error(`markGeneratingAsOk: no encontró fila generating con id=${id}`);
  return parseRow(row);
}

/**
 * 7J.2 — Marca la fila generating como failed, con error_code tipado.
 */
export async function markGeneratingAsFailed(dbOrTrx, params) {
  const { id, errorCode, errorMessage, latencyMs } = params || {};
  if (!Number.isInteger(id) || id < 1) throw new TypeError("id inválido");
  if (typeof errorCode !== "string" || errorCode.length === 0) {
    throw new TypeError("errorCode obligatorio");
  }
  if (!PERSISTED_ERROR_CODES.has(errorCode)) {
    throw new TypeError(`errorCode '${errorCode}' no está en la whitelist`);
  }
  const latency = assertLatencyOrNull(latencyMs);
  const sanitizedMessage = sanitizeErrorMessage(errorMessage);
  const [row] = await dbOrTrx("session_analyses")
    .where({ id, status: "generating" })
    .update({
      status: "failed",
      error_code: errorCode,
      error_message: sanitizedMessage,
      latency_ms: latency,
      analysis: null,
    })
    .returning("*");
  if (!row) throw new Error(`markGeneratingAsFailed: no encontró fila generating con id=${id}`);
  return parseRow(row);
}

/**
 * Historial completo (ok + failed) de una sesión, ordenado desc por created_at.
 * Justificación de existir en 7F (aunque 7G no está aún):
 * - los tests requieren verificar historial;
 * - es la primitiva mínima e independiente de una query de "latest".
 */
export async function getAnalysesForSession(dbOrTrx, sessionId) {
  assertSessionId(sessionId);
  const rows = await dbOrTrx("session_analyses")
    .where({ session_id: sessionId })
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }])
    .select("*");
  return rows.map(parseRow);
}

export const ANALYSIS_ERROR_MESSAGE_MAX = ERROR_MESSAGE_MAX;
