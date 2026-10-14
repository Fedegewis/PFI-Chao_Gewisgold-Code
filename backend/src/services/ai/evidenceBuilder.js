// Builder determinístico de evidence (schema v2+).
//
// Motivación: en schema v1 el modelo generaba evidence enumerando métricas
// del contexto, lo que (a) producía repetición con el resto del análisis,
// (b) era frecuente fuente de ANALYSIS_EVIDENCE_INVALID por desalineación
// numérica, y (c) desperdiciaba tokens de generación.
//
// En schema v2 la evidencia es un dato objetivo: el backend ya conoce TODAS
// las métricas con precisión total y puede exponerlas sin pasar por el modelo.
// Esto elimina alucinaciones numéricas, reduce latencia y libera al prompt
// de pedir un bloque que la UI puede renderizar directamente.
//
// Ampliación v2.3 (BUG-09): el prompt ya no obliga a Ollama a repetir
// cantidad / aciertos / errores / duración / mood en summary. Esos datos se
// exponen acá para que la UI los renderice como tiles al lado del summary.
//
// Función pura: recibe el contexto ya construido, devuelve el array evidence.

// Métricas globales que se exponen por default. Elegimos las más relevantes
// para el seguimiento profesional del paciente.
const GLOBAL_METRICS = Object.freeze([
  "total_questions",
  "correct_answers",   // alias semántico de correct_count
  "incorrect_answers", // alias semántico de incorrect_count
  "accuracy",
  "completion_rate",
  "mean_latency_ms",
]);

// Métricas por sección. Mantenemos las de análisis anteriores + cantidades
// agregadas por sección para que la UI pueda armar "tiles por sección".
const SECTION_METRICS = Object.freeze([
  "total_questions",
  "correct_answers",
  "incorrect_answers",
  "accuracy",
  "completion_rate",
  "mean_latency_ms",
]);

// Metadata de sesión (no métrica de session_results pero sí dato objetivo).
// Scope "session" para distinguirla de la agregación global/sección.
const SESSION_FIELDS = Object.freeze([
  "duration_seconds",
  "patient_reported_mood",
]);

// Techo ampliado: antes 12; ahora 24 porque triplicamos la cardinalidad
// aproximada (3 métricas → ~6-7) por scope.
const MAX_EVIDENCE_ENTRIES = 24;

// Lee el valor correspondiente del dict de métricas aplicando los aliases
// (correct_answers ← correct_count, incorrect_answers ← incorrect_count).
function readMetric(dict, metric) {
  if (!dict || typeof dict !== "object") return undefined;
  if (metric === "correct_answers") {
    if ("correct_answers" in dict) return dict.correct_answers;
    if ("correct_count" in dict) return dict.correct_count;
    return undefined;
  }
  if (metric === "incorrect_answers") {
    if ("incorrect_answers" in dict) return dict.incorrect_answers;
    if ("incorrect_count" in dict) return dict.incorrect_count;
    return undefined;
  }
  return dict[metric];
}

/**
 * @param {object} context  Salida de buildSessionAnalysisContext (schema v2).
 * @returns {Array<{scope:'global'|'section'|'session', metric:string, value:*, section_slug?:string}>}
 */
export function buildEvidenceFromContext(context) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  const out = [];

  // 1) Scope session: duration + mood si están presentes.
  //    mood: si es null (no autorreportado), lo exponemos con value=null para
  //    que la UI pueda renderizar "no registrado" de forma explícita (y nunca
  //    inventar). duration_seconds idem.
  for (const field of SESSION_FIELDS) {
    const value = context[field];
    if (value !== undefined) {
      out.push({ scope: "session", metric: field, value });
    }
  }

  // 2) Scope global: métricas agregadas de la sesión completa.
  const globalMetrics = context.global?.metrics || {};
  for (const metric of GLOBAL_METRICS) {
    const value = readMetric(globalMetrics, metric);
    if (value !== undefined) {
      out.push({ scope: "global", metric, value });
    }
  }

  // 3) Scope section: por cada sección trabajada en la sesión.
  const sections = Array.isArray(context.sections) ? context.sections : [];
  for (const s of sections) {
    const m = s?.metrics || {};
    for (const metric of SECTION_METRICS) {
      if (out.length >= MAX_EVIDENCE_ENTRIES) break;
      const value = readMetric(m, metric);
      if (value !== undefined) {
        out.push({ scope: "section", metric, value, section_slug: s.slug });
      }
    }
    if (out.length >= MAX_EVIDENCE_ENTRIES) break;
  }
  return out;
}

export const EVIDENCE_GLOBAL_METRICS = GLOBAL_METRICS;
export const EVIDENCE_SECTION_METRICS = SECTION_METRICS;
export const EVIDENCE_SESSION_FIELDS = SESSION_FIELDS;
export const EVIDENCE_MAX_ENTRIES = MAX_EVIDENCE_ENTRIES;
