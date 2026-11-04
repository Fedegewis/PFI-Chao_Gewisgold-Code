// Comparación determinística entre la sesión actual y la previa más reciente
// de la MISMA actividad (section_slug). El cálculo vive en el backend, el
// modelo sólo recibe los deltas ya resueltos.
//
// Motivación (BUG-11): llama3.2:3b produjo comparaciones aritméticas erróneas
// cuando se le pedía calcular diferencias ("44% vs 50% mejoró" cuando ni el
// 50% existía, y el 44% era peor que todas las previas). El backend conoce
// los números con precisión total y determina la dirección sin ambigüedad.
//
// Función pura: no toca DB, no lee env, no llama Ollama.

// Umbrales de ruido debajo de los cuales la variación se considera "sin
// cambio". No son interpretaciones clínicas, son cotas prácticas.
const THRESHOLDS = Object.freeze({
  accuracy_pp: 2.0,       // 2 puntos porcentuales
  latency_ms: 150,        // 150 ms
  completion_rate: 0.03,  // 3 puntos porcentuales de completitud
});

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Simplificación: la direction es puramente aritmética ("subió"/"bajó"/"igual").
// La interpretación (si subir latencia es "peor") la deja al profesional.

/**
 * Encuentra la sesión previa comparable más reciente (misma section_slug).
 * `comparableSessions` ya viene filtrado por filterComparableSessions.
 */
function pickMostRecentComparable(comparableSessions) {
  if (!Array.isArray(comparableSessions) || comparableSessions.length === 0) return null;
  // El array viene ordenado DESC por created_at desde loadPreviousSessions.
  return comparableSessions[0];
}

/**
 * @param {object} input
 * @param {object} input.currentGlobal  Métricas globales de la sesión actual.
 *   { accuracy, completion_rate, mean_latency_ms }
 * @param {Array} input.comparableSessions  Previas ya filtradas por sección.
 * @param {string} input.sectionSlug  Section_slug de la sesión actual (identificador narrativo).
 * @param {number|null} [input.currentAdaptiveLevel]  Nivel de dificultad
 *   adaptativo de la sesión actual (migración 018). El de la referencia sale
 *   de `reference.adaptive_level`.
 * @returns {object|null}  comparison_metrics o null si no hay comparables.
 */
export function buildComparisonMetrics({ currentGlobal, comparableSessions, sectionSlug, currentAdaptiveLevel = null }) {
  const reference = pickMostRecentComparable(comparableSessions);
  if (!reference) return null;
  if (!currentGlobal || typeof currentGlobal !== "object") return null;

  const curAcc = toNumberOrNull(currentGlobal.accuracy);
  const curLat = toNumberOrNull(currentGlobal.mean_latency_ms);
  const curCmp = toNumberOrNull(currentGlobal.completion_rate);

  const prev = reference.global_metrics || {};
  const prvAcc = toNumberOrNull(prev.accuracy);
  const prvLat = toNumberOrNull(prev.mean_latency_ms);
  const prvCmp = toNumberOrNull(prev.completion_rate);

  // Puntos porcentuales para accuracy/completion_rate: delta × 100 (los
  // valores vienen en 0..1). Latencia queda en ms.
  function buildMetric(current, previous, kind) {
    if (current === null || previous === null) {
      return { current, previous, direction: "sin_datos" };
    }
    if (kind === "accuracy") {
      const deltaPP = (current - previous) * 100;
      const dir = Math.abs(deltaPP) < THRESHOLDS.accuracy_pp ? "igual" : (deltaPP > 0 ? "subió" : "bajó");
      return {
        current,
        previous,
        delta_percentage_points: Number(deltaPP.toFixed(2)),
        direction: dir,
      };
    }
    if (kind === "completion") {
      const deltaPP = (current - previous) * 100;
      const thresholdPP = THRESHOLDS.completion_rate * 100;
      const dir = Math.abs(deltaPP) < thresholdPP ? "igual" : (deltaPP > 0 ? "subió" : "bajó");
      return {
        current,
        previous,
        delta_percentage_points: Number(deltaPP.toFixed(2)),
        direction: dir,
      };
    }
    if (kind === "latency") {
      const deltaMs = current - previous;
      const dir = Math.abs(deltaMs) < THRESHOLDS.latency_ms ? "igual" : (deltaMs > 0 ? "subió" : "bajó");
      return {
        current,
        previous,
        delta_ms: Math.round(deltaMs),
        direction: dir,
      };
    }
    return { current, previous, direction: "sin_datos" };
  }

  return Object.freeze({
    section_slug: sectionSlug,
    reference: Object.freeze({
      // No exponemos id ni created_at absoluto: compatible con criterio de
      // minimización. Antigüedad relativa útil si vino en reference.
      days_before: Number.isInteger(reference.days_before) ? reference.days_before : null,
      duration_seconds: reference.duration_seconds ?? null,
    }),
    accuracy: Object.freeze(buildMetric(curAcc, prvAcc, "accuracy")),
    completion_rate: Object.freeze(buildMetric(curCmp, prvCmp, "completion")),
    mean_latency_ms: Object.freeze(buildMetric(curLat, prvLat, "latency")),
    ...buildDifficultyLevelField(currentAdaptiveLevel, reference.adaptive_level),
  });
}

function levelOrNull(v) {
  return Number.isInteger(v) && v >= 1 && v <= 3 ? v : null;
}

// P1 (mecanismo adaptativo): la precisión de dos sesiones armadas con
// distinto nivel de dificultad no es directamente comparable. Se informa el
// nivel de ambas para que el panel y observationsBuilder lo aclaren.
//   same = true   → mismo nivel
//   same = false  → niveles distintos
//   same = null   → alguna de las dos es anterior al mecanismo (sin nivel)
// Si ninguna tiene nivel (todo histórico), el campo se omite y la salida es
// idéntica a la previa al mecanismo adaptativo.
function buildDifficultyLevelField(currentRaw, previousRaw) {
  const current = levelOrNull(currentRaw);
  const previous = levelOrNull(previousRaw);
  if (current === null && previous === null) return {};
  const same = current !== null && previous !== null ? current === previous : null;
  return { difficulty_level: Object.freeze({ current, previous, same }) };
}

export const COMPARISON_THRESHOLDS = THRESHOLDS;
