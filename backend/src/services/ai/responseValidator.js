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
  filterAspects,
  findFactContradiction,
  findForbiddenClaim,
  findMalformedSummary,
  findUngroundedSentence,
  NUMERIC_METRIC_PATTERNS,
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
  // 3.6 (política "filter"): un aspecto más largo se descarta, no rechaza.
  aspectMaxFiltered: 240,
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
// (Los patrones viven en contentSafety.NUMERIC_METRIC_PATTERNS, compartidos con
// la revisión al leer y con el filtro de aspectos.)

function joinTexts(texts) {
  return texts.filter((t) => typeof t === "string" && t.length > 0).join("\n");
}

function failSemantic(reason, path, message) {
  fail(CODES.SCHEMA_INVALID, message, path, { reason });
}

function runSemanticChecks({ summary, aspects }, grounding, facts, { reportedMood = null } = {}) {
  const aspTexts = Array.isArray(aspects) ? aspects : [];
  const fullText = joinTexts([summary, ...aspTexts]);

  const claim = findForbiddenClaim(fullText, { reportedMood });
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

// 3.6: el modelo devuelve los párrafos como arreglo (más estable para el 3B
// que escribir saltos de línea dentro de un string JSON). Se unen con una
// línea en blanco; el panel los muestra como párrafos.
const PARAGRAPHS_MAX = 4;
const PARAGRAPH_MAX_CHARS = 1100;
const ASPECT_IN_PARAGRAPH = /^(?:observar|registrar|revisar|comparar)\b/i;

function summaryFromParagraphs(raw) {
  assertArray(raw, "paragraphs", { max: PARAGRAPHS_MAX });
  if (raw.length === 0) fail(CODES.SCHEMA_INVALID, "paragraphs no puede ser vacío", "paragraphs");
  const parts = raw.map((p, i) => assertString(p, `paragraphs[${i}]`, { max: PARAGRAPH_MAX_CHARS }).trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) fail(CODES.SCHEMA_INVALID, "paragraphs sin contenido", "paragraphs");
  return parts.join("\n\n");
}

/**
 * Parsea y valida el texto crudo del modelo contra el contexto.
 *
 * @param {string} rawText
 * @param {object} context   Salida de buildSessionAnalysisContext (v2+).
 * @param {object} [options]
 *   - observations/followUp: observaciones determinísticas de la sesión. Si
 *     se proveen, el summary debe estar anclado a ellas.
 *   - factSentences (3.6): frases de sessionFacts que el modelo recibió;
 *     también respaldan el anclaje.
 *   - detail (3.6): ficha de sessionFacts (tipos, tiempos, nivel, ánimo).
 *     Habilita la mención del estado de ánimo informado y la verificación
 *     de esos hechos.
 *   - checkFacts: verifica que el summary no contradiga los datos del
 *     contexto (contentSafety.findFactContradiction).
 *   - checkForm: summary (o cada párrafo) truncado o mal formado.
 *   - acceptParagraphs (3.6): admite `paragraphs` en lugar de `summary`.
 *   - summaryMax: techo de caracteres del summary (default LIMITS.summaryMax).
 *   - aspectsPolicy:
 *       "validate" (contrato ≤3.4, default): valida aspects_to_review junto
 *         con el summary; cualquier falla rechaza todo.
 *       "discard" (3.5): no se piden; si llegan se descartan sin evaluarlos.
 *       "filter" (3.6): cada aspecto se evalúa con las mismas reglas que el
 *         summary (familias, cifras, anclaje, hechos) y se descarta si no
 *         cumple o si repite una observación o seguimiento automático.
 *   - onAspectsFiltered(dropped): callback opcional con los descartados
 *     (para métricas de evaluación; no se persiste).
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

  const allowed = options.acceptParagraphs
    ? new Set([...ROOT_ALLOWED_FIELDS, "paragraphs"])
    : ROOT_ALLOWED_FIELDS;
  assertOnlyAllowedFields(parsed, allowed, "root");

  // 3.6: con `paragraphs` el schema lo fija el backend; si el modelo omite
  // schema_version se completa (un valor distinto sigue siendo un error).
  if (options.acceptParagraphs && parsed.paragraphs !== undefined && parsed.schema_version === undefined) {
    parsed = { ...parsed, schema_version: SCHEMA_VERSION };
  }
  if (parsed.schema_version !== SCHEMA_VERSION) {
    fail(
      CODES.SCHEMA_INVALID,
      `schema_version debe ser '${SCHEMA_VERSION}', recibido ${JSON.stringify(parsed.schema_version)}`,
      "schema_version"
    );
  }

  let rawSummary = parsed.summary;
  if (options.acceptParagraphs && parsed.paragraphs !== undefined) {
    if (parsed.summary !== undefined) {
      fail(CODES.SCHEMA_INVALID, "Se recibieron summary y paragraphs a la vez", "paragraphs");
    }
    rawSummary = summaryFromParagraphs(parsed.paragraphs);
  }
  const summaryMax = Number.isInteger(options.summaryMax) && options.summaryMax > 0
    ? options.summaryMax
    : LIMITS.summaryMax;
  const summary = assertString(rawSummary, "summary", { max: summaryMax });

  // Formato de aspects (array, tipos, largo) en "validate" y "filter"; en
  // "filter" el contenido se evalúa aspecto por aspecto más abajo.
  const policy = options.aspectsPolicy || "validate";
  const preDropped = [];
  let aspects;
  if (policy === "discard") aspects = [];
  else if (policy === "filter") {
    // 3.6: un aspecto mal formado (no string, demasiado largo, sobrante) se
    // descarta; no invalida el summary ya validado.
    const raw = parsed.aspects_to_review;
    if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
      fail(CODES.SCHEMA_INVALID, "aspects_to_review debe ser array", "aspects_to_review");
    }
    aspects = [];
    for (const a of Array.isArray(raw) ? raw : []) {
      if (typeof a !== "string" || a.trim().length === 0) preDropped.push({ text: String(a), reason: "invalid" });
      else if (a.length > LIMITS.aspectMaxFiltered) preDropped.push({ text: a, reason: "max_length_exceeded" });
      else aspects.push(a);
    }
  } else aspects = validateAspects(parsed.aspects_to_review);

  const observations = Array.isArray(options.observations) ? options.observations : [];
  const followUp = Array.isArray(options.followUp) ? options.followUp : [];
  const factSentences = Array.isArray(options.factSentences) ? options.factSentences : [];
  const grounding = observations.length > 0
    ? buildSupportedStems({
      observations,
      followUp,
      activityNames: (Array.isArray(context.sections) ? context.sections : [])
        .flatMap((s) => [s?.name, s?.slug])
        .filter((x) => typeof x === "string"),
      facts: factSentences,
    })
    : null;

  const detail = options.detail && typeof options.detail === "object" ? options.detail : null;
  const facts = options.checkFacts ? buildFactSheet(context, detail) : null;
  const reportedMood = detail?.mood || null;

  // Forma (3.5): summary truncado por la gramática JSON o con entidades
  // HTML. Sólo en la política de generación vigente (checkForm). 3.6: cada
  // párrafo debe estar completo.
  if (options.checkForm) {
    for (const part of summary.split(/\n\s*\n/)) {
      // 3.6: un párrafo que empieza como punto de seguimiento ("Observar…")
      // es la lista de aspectos volcada en el texto narrativo (evaluación
      // local 2026-11-05): no es una síntesis bien formada.
      const malformed = findMalformedSummary(part)
        || (options.acceptParagraphs && ASPECT_IN_PARAGRAPH.test(part) ? "aspects_in_paragraph" : null);
      if (malformed) {
        failSemantic("malformed_summary", "summary", `Summary incompleto o mal formado (${malformed})`);
      }
    }
  }

  let keptAspects = aspects;
  if (policy === "filter") {
    runSemanticChecks({ summary, aspects: [] }, grounding, facts, { reportedMood });
    const { kept, dropped } = filterAspects(aspects, {
      stems: grounding,
      facts,
      reportedMood,
      repeated: [...observations, ...followUp],
    });
    // Máximo de aspectos: los primeros que cumplen.
    keptAspects = kept.slice(0, LIMITS.aspectsCountMax);
    const overflow = kept.slice(LIMITS.aspectsCountMax).map((text) => ({ text, reason: "over_max_count" }));
    if (typeof options.onAspectsFiltered === "function") options.onAspectsFiltered([...preDropped, ...dropped, ...overflow]);
  } else {
    runSemanticChecks({ summary, aspects }, grounding, facts, { reportedMood });
  }

  const out = {
    schema_version: SCHEMA_VERSION,
    summary,
    aspects_to_review: keptAspects,
  };
  return Object.freeze(out);
}

export const ANALYSIS_SCHEMA_VERSION = SCHEMA_VERSION;
export const ANALYSIS_LIMITS = LIMITS;
