// 7D: Context Builder — capa determinística entre DB y IA.
//
// Convierte datos ya calculados por MenteActiva (session_results + metadata de
// sección + dominios cognitivos asociados a esa sesión) en un objeto plano,
// serializable, versionado y con WHITELIST estricta de campos.
//
// Principios (7D §1, §2, §6):
// - No inventa umbrales ni clasificaciones ("rápido", "bueno", etc.).
// - No genera texto interpretativo — sólo transporta números y metadata segura.
// - No incluye PII (name, email, google_id), IDs sensibles (professional_id),
//   ni respuestas del paciente, ni correct_answer[_snapshot], ni feedback_*,
//   ni prompt_snapshot ni stimulus_snapshot.
// - Función pura: sin DB, sin process.env, sin req/res, sin fetch.
//
// El caller (llegará en 7G) es responsable de hacer las queries con ownership
// verificado y pasar únicamente los campos ya proyectados.

// Schema v2 (vigente): agrega soporte para `previous_sessions` (historial
// longitudinal del mismo paciente). El schema del CONTEXT es independiente
// del schema del OUTPUT; aquí se bumpea porque el promptBuilder y el
// validator están acoplados a esta versión. Análisis persistidos en v1
// siguen siendo renderizables por la UI (compatibilidad de lectura).
const SCHEMA_VERSION = "2";

// Whitelist explícita de campos numéricos de session_results que viajan al
// contexto IA. Cambiar esta lista implica también cambiar SCHEMA_VERSION.
const RESULT_METRIC_FIELDS = Object.freeze([
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

// Los NUMERIC de Postgres llegan como string vía pg. Aceptamos string parseable
// y number, y normalizamos a Number|null. Cualquier valor no parseable → error.
function normalizeMetric(field, raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new TypeError(`Metric '${field}' no es finito: ${raw}`);
    }
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new TypeError(`Metric '${field}' no es numérico: '${raw}'`);
    }
    return n;
  }
  throw new TypeError(`Metric '${field}' con tipo inesperado: ${typeof raw}`);
}

function pickMetrics(source, ctx = "session_results") {
  const out = {};
  for (const f of RESULT_METRIC_FIELDS) {
    if (!(f in source)) {
      throw new TypeError(`${ctx} sin campo requerido '${f}'`);
    }
    out[f] = normalizeMetric(f, source[f]);
  }
  return out;
}

// Sección: metadata de sections + metrics de session_results por section.
// cognitive_domains viene como array de slugs — no de objetos DB.
function buildSectionEntry(sectionInput) {
  if (!sectionInput || typeof sectionInput !== "object") {
    throw new TypeError("section input inválido");
  }
  const { slug, name, cognitive_domain_slugs, result } = sectionInput;

  if (typeof slug !== "string" || slug.length === 0) {
    throw new TypeError("section.slug obligatorio (string no vacío)");
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("section.name obligatorio (string no vacío)");
  }
  if (!Array.isArray(cognitive_domain_slugs)) {
    throw new TypeError("section.cognitive_domain_slugs debe ser array");
  }
  const domains = [];
  const seen = new Set();
  for (const d of cognitive_domain_slugs) {
    if (typeof d !== "string" || d.length === 0) {
      throw new TypeError("cognitive_domain_slugs debe contener strings no vacíos");
    }
    if (!seen.has(d)) {
      seen.add(d);
      domains.push(d);
    }
  }
  domains.sort(); // determinismo

  const metrics = pickMetrics(result, `section '${slug}' result`);

  return {
    slug,
    name,
    cognitive_domain_slugs: domains,
    metrics,
  };
}

// Entrada de historial (v2). Transporta sólo métricas globales + slugs de
// secciones/dominios trabajados. NO incluye PII, NO incluye detalles por
// pregunta, NO permite inferencias cross-domain (el prompt lo prohíbe
// explícitamente). `days_before` es la antigüedad relativa a la sesión actual
// cuando el caller la pasa; si no, se omite.
function buildPreviousSessionEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("previous_sessions entry inválido");
  }
  const { global_metrics, section_slugs, cognitive_domain_slugs, duration_seconds, days_before } = entry;
  if (!global_metrics || typeof global_metrics !== "object") {
    throw new TypeError("previous_sessions entry: global_metrics obligatorio");
  }
  const metrics = pickMetrics(global_metrics, "previous_sessions entry global_metrics");
  const sectionsOut = [];
  const seenSections = new Set();
  for (const slug of Array.isArray(section_slugs) ? section_slugs : []) {
    if (typeof slug === "string" && slug.length > 0 && !seenSections.has(slug)) {
      seenSections.add(slug);
      sectionsOut.push(slug);
    }
  }
  sectionsOut.sort();
  const domainsOut = [];
  const seenDomains = new Set();
  for (const slug of Array.isArray(cognitive_domain_slugs) ? cognitive_domain_slugs : []) {
    if (typeof slug === "string" && slug.length > 0 && !seenDomains.has(slug)) {
      seenDomains.add(slug);
      domainsOut.push(slug);
    }
  }
  domainsOut.sort();
  const out = {
    section_slugs: sectionsOut,
    cognitive_domain_slugs: domainsOut,
    global_metrics: metrics,
  };
  if (duration_seconds !== undefined && duration_seconds !== null) {
    if (!Number.isFinite(duration_seconds) || duration_seconds < 0) {
      throw new TypeError("previous_sessions entry: duration_seconds inválido");
    }
    out.duration_seconds = duration_seconds;
  }
  if (days_before !== undefined && days_before !== null) {
    if (!Number.isFinite(days_before) || days_before < 0) {
      throw new TypeError("previous_sessions entry: days_before inválido");
    }
    out.days_before = Math.round(days_before);
  }
  return out;
}

/**
 * Construye el contexto que se enviará a la IA para una sesión completada.
 *
 * AJUSTE 7E §0: session.id NO forma parte del boundary IA. El backend lo usa
 * para ownership/persistencia/routing, pero el modelo no necesita conocer
 * identificadores internos para sintetizar métricas. El caller sigue
 * pasándolo (o `duration_seconds` derivado), pero jamás aparece en el output.
 *
 * @param {object} input
 * @param {object} [input.session]
 * @param {number} [input.session.duration_seconds]    Number|null; derivado por el caller de completed_at - started_at
 * @param {object} input.global                        fila de session_results con section_id = NULL
 * @param {Array}  input.sections                      [{ slug, name, cognitive_domain_slugs:[], result:{...session_results row...} }]
 *
 * AJUSTE 7G §4: patient.age fue REMOVIDO del boundary IA.
 * MenteActiva v1 no tiene reglas normativas por edad, por lo tanto la
 * edad no puede aportar a una síntesis factual sin habilitar
 * comparaciones normativas indebidas. Si en el futuro se agregan
 * normativas explícitas, este campo puede reintroducirse.
 *
 * @returns {object} contexto plano y determinístico (§3, §7)
 */
// Mood permitido como contexto autorreportado (v1.5). Si el valor no está
// en la whitelist, el contextBuilder se niega a emitirlo — nunca "inventa"
// uno diferente ni lo normaliza silenciosamente. Mantiene la fuente de verdad
// alineada con el CHECK constraint de sessions.patient_reported_mood.
const ALLOWED_MOODS = new Set(["alegria", "bien", "calma", "cansancio", "tristeza"]);

export function buildSessionAnalysisContext(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("input obligatorio");
  }
  const { session, global, sections } = input;

  let durationSeconds = null;
  let patientReportedMood = null;
  if (session !== undefined && session !== null) {
    if (typeof session !== "object") {
      throw new TypeError("input.session, si se pasa, debe ser objeto");
    }
    if (session.duration_seconds !== undefined && session.duration_seconds !== null) {
      if (!Number.isFinite(session.duration_seconds) || session.duration_seconds < 0) {
        throw new TypeError("session.duration_seconds debe ser number >= 0 o null");
      }
      durationSeconds = session.duration_seconds;
    }
    if (session.patient_reported_mood !== undefined && session.patient_reported_mood !== null) {
      if (typeof session.patient_reported_mood !== "string" || !ALLOWED_MOODS.has(session.patient_reported_mood)) {
        throw new TypeError("session.patient_reported_mood debe ser uno de los valores permitidos o null");
      }
      patientReportedMood = session.patient_reported_mood;
    }
  }

  if (!global || typeof global !== "object") {
    throw new TypeError("input.global obligatorio");
  }
  const globalMetrics = pickMetrics(global, "global result");

  if (!Array.isArray(sections) || sections.length === 0) {
    throw new TypeError("input.sections debe ser array no vacío");
  }

  // previous_sessions (v2): array opcional de sesiones completadas anteriores
  // del MISMO paciente, provistas por el caller (loadSessionAnalysisInput +
  // historicalContext). El contextBuilder no decide la política de selección —
  // solo valida shape y transporta la data al modelo. Si no viene o viene
  // vacío, se omite del output (no se emite `previous_sessions: []`).
  let previousEntries = null;
  if (input.previous_sessions !== undefined && input.previous_sessions !== null) {
    if (!Array.isArray(input.previous_sessions)) {
      throw new TypeError("input.previous_sessions debe ser array");
    }
    previousEntries = input.previous_sessions.map(buildPreviousSessionEntry);
  }

  const sectionEntries = sections.map(buildSectionEntry);
  // determinismo: ordenar por slug (los sections del payload real pueden venir por display_order)
  sectionEntries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  // Union de dominios cognitivos trabajados en la sesión (agregado seguro).
  const domainSet = new Set();
  for (const s of sectionEntries) for (const d of s.cognitive_domain_slugs) domainSet.add(d);
  const cognitiveDomainsTouched = [...domainSet].sort();

  const ctx = {
    schema_version: SCHEMA_VERSION,
    language: "es",
    // AJUSTE 7E §0: sin session.id. Se conserva sólo duration_seconds cuando
    // el caller lo derivó, porque es información factual útil al modelo.
    // AJUSTE 7G §4: sin patient (age removida — sin normativas por edad).
    duration_seconds: durationSeconds,
    // v1.5: snapshot inmutable del mood autorreportado por el paciente al
    // iniciar la sesión. Si el paciente no autorreportó, se omite enteramente
    // del contexto (no se emite patient_reported_mood=null) para no inducir
    // al modelo a inventar texto sobre un dato ausente.
    ...(patientReportedMood !== null ? { patient_reported_mood: patientReportedMood } : {}),
    global: {
      metrics: globalMetrics,
    },
    sections: sectionEntries,
    cognitive_domains_touched: cognitiveDomainsTouched,
    // v2: historial longitudinal. Se emite SOLO si el caller pasó entries
    // válidas. Si no hay previas (paciente nuevo o inicio del seguimiento),
    // el campo se omite enteramente para que el modelo no reciba un array
    // vacío que podría inducir texto comparativo sin base.
    ...(previousEntries && previousEntries.length > 0 ? { previous_sessions: previousEntries } : {}),
    // v2.4 (BUG-11): comparación determinística pre-calculada por el backend.
    // El caller la provee ya resuelta (via comparisonBuilder). Si no viene,
    // no se emite — el modelo no debe inventarla.
    ...(input.comparison_metrics ? { comparison_metrics: input.comparison_metrics } : {}),
  };

  // Freeze superficial: el caller no debería mutar el contexto una vez emitido.
  return Object.freeze(ctx);
}

export const CONTEXT_SCHEMA_VERSION = SCHEMA_VERSION;
export const CONTEXT_WHITELIST_METRICS = RESULT_METRIC_FIELDS;
