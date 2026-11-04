// 7E: parser + validador estricto del output de la IA (schema v3).
//
// parseAndValidateSessionAnalysis(rawText, context) -> normalized object
//   Lanza AnalysisValidationError con code tipado.
//
// Función pura: sin DB, sin Ollama, sin process.env, sin req/res.
//
// --------------------------------------------------------------------------
// CONTRATO IA v3 (prompt_version 3.0)
// --------------------------------------------------------------------------
// Rediseño motivado por inestabilidad persistente de llama3.2:3b bajo el
// contrato v2 (ver CLAUDE.md § "Contrato IA v3"). Trasladamos TODAS las
// responsabilidades estructuradas al backend y dejamos al modelo ÚNICAMENTE
// la síntesis descriptiva en texto libre + los puntos sugeridos de revisión.
//
// Output del modelo (v3):
//   {
//     "schema_version": "3",
//     "summary": "<= 500 chars",
//     "aspects_to_review": ["<= 180 chars", ...]  // opcional, ≤ 5 items
//   }
//
// Lo que YA NO genera el modelo:
//   - observations_by_section (el backend expone las actividades y sus
//     métricas; no se pide al modelo que escriba por sección)
//   - comparison (comparison_metrics determinístico del backend es la
//     fuente única)
//   - métricas numéricas, mood, dominios, slugs
//
// Lo que el backend inyecta antes de persistir:
//   - evidence (buildEvidenceFromContext)
//   - comparison_metrics (buildComparisonMetrics)
//
// Validaciones mantenidas (acotadas):
//   - JSON válido, schema_version exacto, campos permitidos, tipos, límites.
//   - Términos clínicos / calificaciones subjetivas (lista cerrada, no
//     palabras genéricas).
//   - Métricas numéricas introducidas por el modelo (porcentajes, X/Y,
//     "N preguntas", "N segundos"): patrón específico, no bloquea nombres
//     ni cifras genéricas en frases legítimas.
//
// Compatibilidad: análisis persistidos con schema_version "2" se leen con
// otros códigos (el frontend tiene branch por versión). Este validator sólo
// acepta "3" para análisis nuevos.
// --------------------------------------------------------------------------

import {
  AnalysisValidationCodes as CODES,
  AnalysisValidationError,
} from "./validationErrors.js";
import {
  buildFactSheet,
  buildSupportedStems,
  findFactContradiction,
  findForbiddenClaim,
  findMalformedSummary,
  findUngroundedSentence,
} from "./contentSafety.js";

const SCHEMA_VERSION = "3";

// Campos permitidos en el root. Cualquier otro campo → UNEXPECTED_FIELD.
// NOTA: no toleramos silenciosamente campos antiguos del contrato v2
// (observations_by_section, comparison, evidence) para forzar al modelo a
// cumplir el contrato nuevo. El prompt v3.0 no los pide.
const ROOT_ALLOWED_FIELDS = new Set([
  "schema_version",
  "summary",
  "aspects_to_review",
]);

// summaryMax: 1000 (v3.2). Ajuste tras una segunda observación empírica:
// con prompt v3.1 (techo 600) el modelo generó 735 chars pese a pedir
// 100-250. Elevamos el techo real a 1000 para absorber la distribución
// observada (429-735) con holgura, sin seguir afinando el prompt. Pasado
// 1000 se sigue rechazando; nunca se trunca silenciosamente. Las
// validaciones semánticas (términos clínicos, cifras numéricas) se
// mantienen idénticas.
const LIMITS = Object.freeze({
  summaryMax: 1000,
  aspectMax: 180,
  aspectsCountMax: 5,
});

function fail(code, message, path, info) {
  const opts = {};
  if (path !== undefined) opts.path = path;
  if (info !== undefined) opts.info = info;
  throw new AnalysisValidationError(code, message, Object.keys(opts).length ? opts : undefined);
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
    fail(
      CODES.SCHEMA_INVALID,
      `${path} excede ${max} caracteres (${v.length})`,
      path,
      { reason: "max_length_exceeded", max, actual: v.length }
    );
  }
  return v;
}

function assertArray(v, path, { max } = {}) {
  if (!Array.isArray(v)) fail(CODES.SCHEMA_INVALID, `${path} debe ser array`, path);
  if (max !== undefined && v.length > max) {
    fail(CODES.SCHEMA_INVALID, `${path} excede ${max} elementos (${v.length})`, path);
  }
}

function validateSummary(v) {
  return assertString(v, "summary", { max: LIMITS.summaryMax });
}

function validateAspects(rawList) {
  if (rawList === undefined || rawList === null) return [];
  assertArray(rawList, "aspects_to_review", { max: LIMITS.aspectsCountMax });
  const out = [];
  for (let i = 0; i < rawList.length; i++) {
    out.push(assertString(rawList[i], `aspects_to_review[${i}]`, { max: LIMITS.aspectMax }));
  }
  return out;
}

// ---------------- Chequeos semánticos v3 ----------------------------------
//
// Lista cerrada de PATRONES ESPECÍFICOS. No palabras genéricas: cada entrada
// corresponde a un error observado en salidas reales del modelo. No bloqueamos
// términos descriptivos válidos ("memoria", "atención", "preguntas", etc).

// 1) Afirmaciones no permitidas (diagnóstico, descarte clínico, eficacia
//    terapéutica, capacidades, juicios evaluativos, especulación, eco de las
//    reglas, atribución a terceros). Se evalúan por FAMILIAS sobre texto
//    normalizado (sin tildes, minúsculas): ver contentSafety.js. Reemplaza a
//    las listas CLINICAL_PATTERNS / UNAUTHORIZED_ACTOR_PATTERNS anteriores,
//    que no cubrían plurales ("patologías") ni límites con tildes.

// 2) Métricas numéricas inventadas o repetidas por el modelo. Detectamos
//    patrones específicos de cifras que corresponden a métricas (porcentajes,
//    fracciones de preguntas, tiempos). No bloqueamos cifras aisladas que
//    puedan aparecer en una frase legítima (ej: "una actividad").
const NUMERIC_METRIC_PATTERNS = [
  // Porcentajes: "50%", "50 %", "50 por ciento".
  /\b\d{1,3}\s?%/,
  /\b\d{1,3}\s+por\s+ciento\b/i,
  // Fracciones aciertos/total: "5/8", "5 de 8".
  /\b\d+\s*\/\s*\d+\b/,
  /\b\d+\s+de\s+\d+\b/i,
  // Cantidades de preguntas/respuestas: "6 preguntas", "4 respuestas", "3 aciertos".
  /\b\d+\s+(preguntas?|respuestas?|aciertos?|errores?|incorrectas?|correctas?)\b/i,
  // Tiempos: "32 segundos", "1 minuto 20 segundos", "820 ms".
  /\b\d+\s+(segundos?|minutos?|ms|milisegundos?)\b/i,
  // Latencia media explícita: "latencia media de 2.3 s".
  /\blatencia\s+(media|promedio|m[ií]nima|m[aá]xima)\s+de\s+\d/i,
];

function joinTexts(texts) {
  return texts.filter((t) => typeof t === "string" && t.length > 0).join("\n");
}

function failSemantic(reason, path, message) {
  fail(CODES.SCHEMA_INVALID, message, path, { reason });
}

function runSemanticChecks({ summary, aspects }, grounding, facts) {
  const aspTexts = Array.isArray(aspects) ? aspects : [];
  const fullText = joinTexts([summary, ...aspTexts]);

  const claim = findForbiddenClaim(fullText);
  if (claim) {
    failSemantic(
      claim.reason,
      "summary",
      `Afirmación no permitida (${claim.label}): "${claim.match}"`
    );
  }

  for (const re of NUMERIC_METRIC_PATTERNS) {
    if (re.test(fullText)) {
      failSemantic(
        "numeric_metric_in_text",
        "summary",
        `Cifra o métrica numérica en el texto generado (las cifras las expone el backend) (match: ${re})`
      );
    }
  }

  // Anclaje: el summary debe parafrasear las OBSERVATIONS determinísticas.
  // Sólo aplica cuando quien llama provee las observaciones de la sesión.
  if (grounding) {
    const ungrounded = findUngroundedSentence(summary, grounding);
    if (ungrounded) {
      failSemantic(
        "ungrounded_statement",
        "summary",
        `Oración sin respaldo en las observaciones de la sesión: "${ungrounded.sentence}"`
      );
    }
  }

  // Consistencia: los hechos cerrados que el texto afirme (completitud,
  // distribución de respuestas, comparación y su validez según el nivel de
  // dificultad) deben coincidir con los datos registrados.
  if (facts) {
    const contradiction = findFactContradiction(summary, facts);
    if (contradiction) {
      failSemantic(
        "contradicts_recorded_data",
        "summary",
        `Afirmación que contradice los datos registrados (${contradiction.claim}): "${contradiction.sentence}"`
      );
    }
  }
}

/**
 * Parsea y valida el texto crudo del modelo contra el contexto.
 *
 * @param {string} rawText
 * @param {object} context   Salida de buildSessionAnalysisContext (v2+).
 * @param {{observations?: string[], followUp?: string[],
 *          checkFacts?: boolean, aspectsPolicy?: "validate"|"discard"}} [options]
 *   - observations/followUp: observaciones determinísticas de la sesión. Si
 *     se proveen, el summary debe estar anclado a ellas.
 *   - checkFacts: verifica que el summary no contradiga los datos del
 *     contexto (contentSafety.findFactContradiction).
 *   - aspectsPolicy: "validate" (contrato ≤3.4, default) valida
 *     aspects_to_review; "discard" (prompt 3.5) no lo pide al modelo y, si
 *     igual llega, lo descarta sin evaluarlo: no se persiste ni se muestra.
 * @returns {object}         Objeto congelado con campos canónicos v3.
 * @throws {AnalysisValidationError}
 */
export function parseAndValidateSessionAnalysis(rawText, context, options = {}) {
  if (typeof rawText !== "string") {
    fail(CODES.INVALID_JSON, "rawText debe ser string");
  }
  if (!isPlainObject(context)) {
    throw new TypeError("context inválido");
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
  const discardAspects = options.aspectsPolicy === "discard";
  const aspects = discardAspects ? [] : validateAspects(parsed.aspects_to_review);

  const observations = Array.isArray(options.observations) ? options.observations : [];
  const grounding = observations.length > 0
    ? buildSupportedStems({
      observations,
      followUp: Array.isArray(options.followUp) ? options.followUp : [],
      activityNames: (Array.isArray(context.sections) ? context.sections : [])
        .flatMap((s) => [s?.name, s?.slug])
        .filter((x) => typeof x === "string"),
    })
    : null;

  const facts = options.checkFacts ? buildFactSheet(context) : null;

  // Forma (3.5): summary truncado por la gramática JSON o con entidades
  // HTML. Sólo en la política de generación vigente (checkForm).
  if (options.checkForm) {
    const malformed = findMalformedSummary(summary);
    if (malformed) {
      failSemantic("malformed_summary", "summary", `Summary incompleto o mal formado (${malformed})`);
    }
  }

  runSemanticChecks({ summary, aspects }, grounding, facts);

  const out = {
    schema_version: SCHEMA_VERSION,
    summary,
    aspects_to_review: aspects,
  };
  return Object.freeze(out);
}

export const ANALYSIS_SCHEMA_VERSION = SCHEMA_VERSION;
export const ANALYSIS_LIMITS = LIMITS;
