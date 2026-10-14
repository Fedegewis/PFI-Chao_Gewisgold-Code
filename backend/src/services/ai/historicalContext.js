// Historial longitudinal para el pipeline IA.
//
// Devuelve hasta N sesiones COMPLETADAS anteriores a una fecha de referencia,
// del MISMO paciente, con sus métricas globales ya calculadas y la metadata
// mínima de las secciones trabajadas. No incluye información identificatoria.
//
// Reglas de selección (contrato acordado):
//   - sessions.patient_id = patientId
//   - sessions.status = 'completed'
//   - sessions.created_at < beforeCreatedAt   (exclusión estricta de la sesión actual)
//   - orden: created_at DESC
//   - límite por defecto: 3
//
// NO compara dominios entre sí ni determina equivalencias: solo transporta
// datos. El contextBuilder/promptBuilder deciden cómo presentarlos al modelo.
//
// Función de infraestructura: pura respecto de env/req/res. Recibe el handle
// Knex por parámetro para que los tests inyecten una conexión aislada.

const DEFAULT_LIMIT = 3;

export const HISTORICAL_SESSION_LIMIT = DEFAULT_LIMIT;

/**
 * Filtra sesiones previas conservando SOLO las comparables con la sesión
 * actual.
 *
 * v2.4 (BUG-11): comparabilidad ESTRICTA por section_slug. Antes aceptábamos
 * sesiones que compartieran un dominio cognitivo tangencial, pero tras la
 * expansión N:M del banco casi cualquier sesión aparecía como "comparable"
 * aunque la actividad fuera muy distinta. Resultado observado: el modelo
 * recibía referencias de secciones distintas y producía comparaciones sin
 * sentido ("44% vs 50% mejoró"). Ahora exigimos coincidencia de section_slug.
 *
 * Si no hay previas de la misma actividad, se devuelve array vacío (sin
 * previous_sessions, sin comparison): mejor no comparar que comparar mal.
 *
 * @param {Array} previousSessions   Salida de loadPreviousSessions.
 * @param {object} currentContext    { section_slugs:[], cognitive_domain_slugs:[] }
 * @returns {Array}                  Subconjunto comparable, orden preservado.
 */
export function filterComparableSessions(previousSessions, currentContext) {
  if (!Array.isArray(previousSessions)) return [];
  if (!currentContext || typeof currentContext !== "object") return [];
  const currentSections = new Set(
    Array.isArray(currentContext.section_slugs) ? currentContext.section_slugs : []
  );
  if (currentSections.size === 0) return [];

  return previousSessions.filter((p) => {
    const sections = Array.isArray(p.section_slugs) ? p.section_slugs : [];
    for (const s of sections) if (currentSections.has(s)) return true;
    return false;
  });
}

/**
 * @param {object} dbOrTrx            Knex connection o transaction.
 * @param {object} params
 * @param {number} params.patientId
 * @param {Date|string} params.beforeCreatedAt   Fecha de la sesión actual.
 * @param {number} [params.limit=3]
 * @returns {Promise<Array<{
 *   id: number,
 *   created_at: Date,
 *   duration_seconds: number|null,
 *   global_metrics: object,
 *   section_slugs: string[],
 *   cognitive_domain_slugs: string[]
 * }>>}
 */
export async function loadPreviousSessions(dbOrTrx, params) {
  const { patientId, beforeCreatedAt, limit = DEFAULT_LIMIT } = params || {};
  if (!Number.isInteger(patientId) || patientId < 1) {
    throw new TypeError("patientId debe ser entero positivo");
  }
  if (!beforeCreatedAt || (typeof beforeCreatedAt !== "string" && !(beforeCreatedAt instanceof Date))) {
    throw new TypeError("beforeCreatedAt obligatorio (Date o string ISO)");
  }
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;

  // Primero: sesiones candidato con metadata y métricas globales (section_id NULL).
  // LEFT JOIN session_results porque una sesión 'completed' siempre debería
  // tener global, pero defendemos contra inconsistencia histórica puntual.
  const rows = await dbOrTrx("sessions as s")
    .leftJoin("session_results as sr", function joinResults() {
      this.on("sr.session_id", "=", "s.id").andOnNull("sr.section_id");
    })
    .where("s.patient_id", patientId)
    .where("s.status", "completed")
    .andWhere("s.created_at", "<", beforeCreatedAt)
    .orderBy("s.created_at", "desc")
    .limit(effectiveLimit)
    .select(
      "s.id as id",
      "s.created_at as created_at",
      "s.started_at as started_at",
      "s.completed_at as completed_at",
      "sr.total_questions",
      "sr.answered_questions",
      "sr.correct_count",
      "sr.incorrect_count",
      "sr.unanswered_count",
      "sr.accuracy",
      "sr.completion_rate",
      "sr.mean_latency_ms",
      "sr.min_latency_ms",
      "sr.max_latency_ms",
      "sr.latency_std_ms"
    );

  if (rows.length === 0) return [];

  // Secciones + dominios cognitivos por sesión. Query única con joins.
  const sessionIds = rows.map((r) => r.id);
  const sectionRows = await dbOrTrx("session_sections as ss")
    .join("sections as sec", "sec.id", "ss.section_id")
    .whereIn("ss.session_id", sessionIds)
    .select("ss.session_id as session_id", "sec.slug as slug");

  const domainRows = await dbOrTrx("session_questions as sq")
    .join("session_sections as ss", "ss.id", "sq.session_section_id")
    .join("question_cognitive_domains as qcd", "qcd.question_id", "sq.question_id")
    .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
    .whereIn("ss.session_id", sessionIds)
    .distinct("ss.session_id as session_id", "cd.slug as slug");

  const sectionsBySessionId = new Map();
  const domainsBySessionId = new Map();
  for (const r of sectionRows) {
    if (!sectionsBySessionId.has(r.session_id)) sectionsBySessionId.set(r.session_id, new Set());
    sectionsBySessionId.get(r.session_id).add(r.slug);
  }
  for (const r of domainRows) {
    if (!domainsBySessionId.has(r.session_id)) domainsBySessionId.set(r.session_id, new Set());
    domainsBySessionId.get(r.session_id).add(r.slug);
  }

  return rows.map((r) => {
    let durationSeconds = null;
    if (r.started_at && r.completed_at) {
      const start = new Date(r.started_at).getTime();
      const end = new Date(r.completed_at).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        durationSeconds = Math.round((end - start) / 1000);
      }
    }
    return {
      id: r.id,
      created_at: r.created_at,
      duration_seconds: durationSeconds,
      global_metrics: {
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
      section_slugs: [...(sectionsBySessionId.get(r.id) || [])].sort(),
      cognitive_domain_slugs: [...(domainsBySessionId.get(r.id) || [])].sort(),
    };
  });
}
