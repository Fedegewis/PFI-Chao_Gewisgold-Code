// 7J.3 — Capa presentacional del análisis IA.
//
// Convierte slugs y métricas técnicas del JSON persistido en etiquetas y
// valores legibles en español para el profesional. NO modifica el contrato
// backend ni el JSON almacenado: solamente traduce en render.

// Nombres humanos de secciones (fuente de verdad conceptual: CLAUDE.md,
// tabla `sections` del backend). Se define aquí para no depender de que el
// backend envíe section_name en el analysis (hoy no lo envía).
export const SECTION_LABELS = Object.freeze({
  memoria_de_trabajo: "Memoria de trabajo",
  atencion_y_calculo: "Atención y cálculo",
  funciones_ejecutivas: "Funciones ejecutivas",
  orientacion_temporal: "Orientación temporal",
  memoria_asociativa: "Memoria asociativa",
  metacognicion: "Metacognición",
  memoria_prospectiva: "Memoria prospectiva",
  atencion_visual: "Atención visual",
  comprension_funcional: "Comprensión funcional",
  orientacion_espacial: "Orientación espacial",
});

// Etiquetas humanas de las métricas permitidas por el schema v1.
export const METRIC_LABELS = Object.freeze({
  total_questions: "Preguntas totales",
  answered_questions: "Preguntas respondidas",
  correct_count: "Respuestas correctas",
  incorrect_count: "Respuestas incorrectas",
  unanswered_count: "Sin responder",
  accuracy: "Precisión",
  completion_rate: "Completitud",
  mean_latency_ms: "Tiempo medio de respuesta",
  min_latency_ms: "Tiempo mínimo de respuesta",
  max_latency_ms: "Tiempo máximo de respuesta",
  latency_std_ms: "Variación del tiempo de respuesta",
});

// Métricas que se muestran como porcentaje (0.5 → 50 %).
const PERCENT_METRICS = new Set(["accuracy", "completion_rate"]);
// Métricas de latencia en ms; se formatean a segundos si >= 1000 ms.
const LATENCY_MS_METRICS = new Set([
  "mean_latency_ms",
  "min_latency_ms",
  "max_latency_ms",
  "latency_std_ms",
]);

export function formatSectionLabel(slug) {
  if (typeof slug !== "string" || slug.length === 0) return "";
  return SECTION_LABELS[slug] || slug;
}

export function formatMetricLabel(metric) {
  if (typeof metric !== "string" || metric.length === 0) return "";
  return METRIC_LABELS[metric] || metric;
}

/**
 * Formatea el valor numérico de una métrica del contexto para lectura humana.
 * Nunca inventa unidades ni interpretaciones; solo cambia representación.
 *   - percent: 0.5 → "50 %"
 *   - latencia < 1000 ms: "820 ms"
 *   - latencia >= 1000 ms: "3,23 s" (locale es-AR con coma decimal)
 *   - conteos: entero como string
 *   - null: "—"
 */
export function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (PERCENT_METRICS.has(metric)) {
    // 0..1 → 0..100 con hasta 1 decimal si aporta.
    const pct = n * 100;
    const rounded = Math.abs(pct - Math.round(pct)) < 0.05
      ? String(Math.round(pct))
      : pct.toFixed(1).replace(".", ",");
    return `${rounded} %`;
  }
  if (LATENCY_MS_METRICS.has(metric)) {
    if (n < 1000) {
      // ms enteros.
      return `${Math.round(n)} ms`;
    }
    const s = n / 1000;
    // Dos decimales, coma decimal es-AR.
    return `${s.toFixed(2).replace(".", ",")} s`;
  }
  // Conteos: intentar mostrar como entero cuando corresponda.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(".", ",");
}

/**
 * Convierte un elemento de `evidence` en representación humana lista para
 * render. Devuelve:
 *   {
 *     group: "Global" | <section_label>,
 *     scope: "global" | "section",
 *     sectionSlug: string | null,
 *     metricLabel: string,
 *     valueLabel: string,
 *   }
 */
export function formatEvidenceEntry(entry) {
  const scope = entry?.scope === "section" ? "section" : "global";
  const sectionSlug = scope === "section" && typeof entry?.section_slug === "string"
    ? entry.section_slug
    : null;
  const group = scope === "global" ? "General" : formatSectionLabel(sectionSlug);
  return {
    scope,
    sectionSlug,
    group,
    metricLabel: formatMetricLabel(entry?.metric),
    valueLabel: formatMetricValue(entry?.metric, entry?.value),
  };
}

/**
 * Agrupa las evidencias por scope/sección para renderizar en secciones
 * separadas. Preserva el orden de aparición del backend dentro de cada grupo.
 * Retorna un array de bloques:
 *   [{ group: "General", items: [{metricLabel, valueLabel}, ...] }, ...]
 */
export function groupEvidenceForRender(evidence) {
  if (!Array.isArray(evidence)) return [];
  const groupsMap = new Map();
  for (const raw of evidence) {
    const e = formatEvidenceEntry(raw);
    if (!groupsMap.has(e.group)) {
      groupsMap.set(e.group, { group: e.group, scope: e.scope, sectionSlug: e.sectionSlug, items: [] });
    }
    groupsMap.get(e.group).items.push({
      metricLabel: e.metricLabel,
      valueLabel: e.valueLabel,
    });
  }
  return [...groupsMap.values()];
}
