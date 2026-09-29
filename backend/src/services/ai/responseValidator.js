// 7E: parser + validador estricto del output de la IA.
//
// parseAndValidateSessionAnalysis(rawText, context) -> normalized object
//   Lanza AnalysisValidationError con code tipado.
//
// Función pura: sin DB, sin Ollama, sin process.env, sin req/res.
//
// Estrategia de seguridad (§6):
// - Minimización del contexto (7D/7E §0).
// - Prompt restrictivo (7E §7).
// - Schema JSON estricto (este módulo).
// - Evidence verificable numéricamente contra el contexto (este módulo).
// - Límites de longitud (este módulo).
// - Separación explícita hechos backend vs síntesis IA.
// NO se aplica blacklist médica como defensa principal.

import {
  AnalysisValidationCodes as CODES,
  AnalysisValidationError,
} from "./validationErrors.js";

const SCHEMA_VERSION = "1";

const ROOT_ALLOWED_FIELDS = new Set([
  "schema_version",
  "summary",
  "observations_by_section",
  "aspects_to_review",
  "evidence",
]);

const OBSERVATION_ALLOWED_FIELDS = new Set(["section_slug", "observation"]);

const EVIDENCE_ALLOWED_FIELDS_GLOBAL = new Set(["scope", "metric", "value"]);
const EVIDENCE_ALLOWED_FIELDS_SECTION = new Set([
  "scope",
  "metric",
  "value",
  "section_slug",
]);

const ALLOWED_METRICS = new Set([
  "total_questions",
  "answered_questions",
  "correct_count",
  "incorrect_count",
  "unanswered_count",
  "accuracy",
  "completion_rate",
  "mean_latency_ms",
  "min_latency_ms",
  "max_latency_ms",
  "latency_std_ms",
]);

// Límites v1 (§2).
const LIMITS = Object.freeze({
  summaryMax: 400,
  observationMax: 240,
  aspectMax: 180,
  aspectsCountMax: 10,        // máximo razonable (§2)
  evidenceCountMax: 40,       // 11 métricas globales + 11 * N secciones; 40 alcanza para 2–3 secciones
});

// Tolerancia numérica para comparar evidence.value contra el contexto.
// Los NUMERIC(5,4)/NUMERIC(10,2) ya llegaron normalizados a number en el
// contextBuilder; permitimos un epsilon relativo pequeño por posibles
// re-serializaciones JSON del lado del modelo.
const NUMERIC_EPSILON = 1e-6;

function fail(code, message, path) {
  throw new AnalysisValidationError(code, message, path !== undefined ? { path } : undefined);
}

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function assertOnlyAllowedFields(obj, allowed, path, { failCode = CODES.UNEXPECTED_FIELD } = {}) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(failCode, `Campo no permitido '${key}' en ${path}`, `${path}.${key}`);
    }
  }
}

function assertString(v, path, { max, allowEmpty = false } = {}) {
  if (typeof v !== "string") fail(CODES.SCHEMA_INVALID, `${path} debe ser string`, path);
  if (!allowEmpty && v.length === 0) fail(CODES.SCHEMA_INVALID, `${path} no puede ser vacío`, path);
  if (max !== undefined && v.length > max) {
    fail(CODES.SCHEMA_INVALID, `${path} excede ${max} caracteres (${v.length})`, path);
  }
  return v;
}

function assertArray(v, path, { max } = {}) {
  if (!Array.isArray(v)) fail(CODES.SCHEMA_INVALID, `${path} debe ser array`, path);
  if (max !== undefined && v.length > max) {
    fail(CODES.SCHEMA_INVALID, `${path} excede ${max} elementos (${v.length})`, path);
  }
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function numericMatches(a, b) {
  if (a === null || b === null) return a === b;
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return false;
  const diff = Math.abs(a - b);
  if (diff <= NUMERIC_EPSILON) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return diff / scale <= NUMERIC_EPSILON;
}

function buildContextMetricsIndex(context) {
  const globalMetrics = context.global?.metrics;
  if (!isPlainObject(globalMetrics)) {
    // No es error del modelo, sino del caller — pero es una precondición.
    throw new TypeError("context.global.metrics ausente o inválido");
  }
  const sections = new Map();
  for (const s of context.sections || []) {
    if (!isPlainObject(s?.metrics)) {
      throw new TypeError(`context.sections[${s?.slug}].metrics ausente o inválido`);
    }
    sections.set(s.slug, s.metrics);
  }
  return { global: globalMetrics, sections };
}

function validateSummary(v) {
  return assertString(v, "summary", { max: LIMITS.summaryMax });
}

function validateObservations(rawList, context) {
  assertArray(rawList, "observations_by_section");
  const expected = context.sections.map((s) => s.slug);
  const expectedSet = new Set(expected);
  const seen = new Set();

  if (rawList.length !== expected.length) {
    fail(
      CODES.SECTIONS_MISMATCH,
      `observations_by_section debe tener ${expected.length} entradas (recibidas ${rawList.length})`,
      "observations_by_section"
    );
  }

  const normalized = [];
  for (let i = 0; i < rawList.length; i++) {
    const entry = rawList[i];
    const path = `observations_by_section[${i}]`;
    if (!isPlainObject(entry)) fail(CODES.SCHEMA_INVALID, `${path} debe ser objeto`, path);
    assertOnlyAllowedFields(entry, OBSERVATION_ALLOWED_FIELDS, path);
    const slug = assertString(entry.section_slug, `${path}.section_slug`);
    if (!expectedSet.has(slug)) {
      fail(CODES.SECTIONS_MISMATCH, `Sección desconocida '${slug}' en ${path}`, path);
    }
    if (seen.has(slug)) {
      fail(CODES.SECTIONS_MISMATCH, `Sección duplicada '${slug}' en ${path}`, path);
    }
    if (slug !== expected[i]) {
      fail(
        CODES.SECTIONS_MISMATCH,
        `Orden incorrecto en ${path}: esperado '${expected[i]}', recibido '${slug}'`,
        path
      );
    }
    seen.add(slug);
    const observation = assertString(entry.observation, `${path}.observation`, {
      max: LIMITS.observationMax,
    });
    normalized.push({ section_slug: slug, observation });
  }
  return normalized;
}

function validateAspects(rawList) {
  assertArray(rawList, "aspects_to_review", { max: LIMITS.aspectsCountMax });
  const out = [];
  for (let i = 0; i < rawList.length; i++) {
    out.push(assertString(rawList[i], `aspects_to_review[${i}]`, { max: LIMITS.aspectMax }));
  }
  return out;
}

function validateEvidenceEntry(entry, idx, index) {
  const path = `evidence[${idx}]`;
  if (!isPlainObject(entry)) fail(CODES.EVIDENCE_INVALID, `${path} debe ser objeto`, path);

  const { scope } = entry;
  if (scope !== "global" && scope !== "section") {
    fail(CODES.EVIDENCE_INVALID, `${path}.scope debe ser 'global' o 'section'`, path);
  }

  // Strict fields: distintos según scope. section requiere section_slug; global lo prohíbe.
  const allowed = scope === "global"
    ? EVIDENCE_ALLOWED_FIELDS_GLOBAL
    : EVIDENCE_ALLOWED_FIELDS_SECTION;
  assertOnlyAllowedFields(entry, allowed, path, { failCode: CODES.EVIDENCE_INVALID });

  const metric = entry.metric;
  if (typeof metric !== "string" || !ALLOWED_METRICS.has(metric)) {
    fail(CODES.EVIDENCE_INVALID, `${path}.metric desconocida: ${JSON.stringify(metric)}`, path);
  }

  let expected;
  const normalized = { scope, metric };
  if (scope === "section") {
    if (typeof entry.section_slug !== "string") {
      fail(CODES.EVIDENCE_INVALID, `${path}.section_slug obligatorio para scope=section`, path);
    }
    if (!index.sections.has(entry.section_slug)) {
      fail(CODES.EVIDENCE_INVALID, `${path}.section_slug desconocido: '${entry.section_slug}'`, path);
    }
    expected = index.sections.get(entry.section_slug)[metric];
    normalized.section_slug = entry.section_slug;
  } else {
    // global: assertOnlyAllowedFields ya prohibió section_slug.
    expected = index.global[metric];
  }

  const value = entry.value;
  if (value === null) {
    if (expected !== null) {
      fail(
        CODES.EVIDENCE_INVALID,
        `${path}.value=null no coincide con el contexto (${expected})`,
        path
      );
    }
  } else if (isFiniteNumber(value)) {
    if (!numericMatches(value, expected)) {
      fail(
        CODES.EVIDENCE_INVALID,
        `${path}.value=${value} no coincide con el contexto (${expected})`,
        path
      );
    }
  } else {
    fail(CODES.EVIDENCE_INVALID, `${path}.value debe ser number finito o null`, path);
  }
  normalized.value = value;
  return normalized;
}

function validateEvidence(rawList, context) {
  assertArray(rawList, "evidence", { max: LIMITS.evidenceCountMax });
  if (rawList.length < 1) {
    fail(CODES.EVIDENCE_INVALID, "evidence debe contener al menos 1 elemento", "evidence");
  }
  const index = buildContextMetricsIndex(context);
  const out = [];
  for (let i = 0; i < rawList.length; i++) {
    out.push(validateEvidenceEntry(rawList[i], i, index));
  }
  return out;
}

/**
 * Parsea y valida el texto crudo del modelo contra el contexto.
 *
 * @param {string} rawText
 * @param {object} context   Salida de buildSessionAnalysisContext.
 * @returns {object}         { schema_version, summary, observations_by_section, aspects_to_review, evidence }
 * @throws {AnalysisValidationError}
 */
export function parseAndValidateSessionAnalysis(rawText, context) {
  if (typeof rawText !== "string") {
    fail(CODES.INVALID_JSON, "rawText debe ser string");
  }
  if (!isPlainObject(context) || context.schema_version !== SCHEMA_VERSION) {
    throw new TypeError("context inválido o schema_version no soportado");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    fail(CODES.INVALID_JSON, `JSON.parse falló: ${err.message}`);
  }

  if (!isPlainObject(parsed)) {
    fail(CODES.SCHEMA_INVALID, "root debe ser objeto");
  }

  assertOnlyAllowedFields(parsed, ROOT_ALLOWED_FIELDS, "root");

  if (parsed.schema_version !== SCHEMA_VERSION) {
    fail(
      CODES.SCHEMA_INVALID,
      `schema_version debe ser '${SCHEMA_VERSION}', recibido ${JSON.stringify(parsed.schema_version)}`,
      "schema_version"
    );
  }

  const summary = validateSummary(parsed.summary);
  const observations = validateObservations(parsed.observations_by_section, context);
  const aspects = validateAspects(parsed.aspects_to_review);
  const evidence = validateEvidence(parsed.evidence, context);

  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    summary,
    observations_by_section: observations,
    aspects_to_review: aspects,
    evidence,
  });
}

export const ANALYSIS_SCHEMA_VERSION = SCHEMA_VERSION;
export const ANALYSIS_LIMITS = LIMITS;
export const ANALYSIS_ALLOWED_METRICS = ALLOWED_METRICS;
