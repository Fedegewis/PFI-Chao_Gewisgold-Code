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

// Etiquetas humanas de las métricas permitidas por el schema v1/v2.
// v2.3: agrega los campos nuevos del evidenceBuilder (correct_answers,
// incorrect_answers, duration_seconds, patient_reported_mood).
export const METRIC_LABELS = Object.freeze({
  total_questions: "Preguntas totales",
  answered_questions: "Preguntas respondidas",
  correct_count: "Respuestas correctas",
  incorrect_count: "Respuestas incorrectas",
  // alias semánticos v2.3
  correct_answers: "Respuestas correctas",
  incorrect_answers: "Respuestas incorrectas",
  unanswered_count: "Sin responder",
  accuracy: "Precisión",
  completion_rate: "Completitud",
  mean_latency_ms: "Tiempo medio de respuesta",
  min_latency_ms: "Tiempo mínimo de respuesta",
  max_latency_ms: "Tiempo máximo de respuesta",
  latency_std_ms: "Variación del tiempo de respuesta",
  duration_seconds: "Duración de la sesión",
  patient_reported_mood: "Estado de ánimo informado",
});

// Etiquetas humanas de los moods permitidos (alineado con ALLOWED_MOODS backend).
const MOOD_LABELS = Object.freeze({
  alegria: "Alegría",
  bien: "Bien",
  calma: "Calma",
  cansancio: "Cansancio",
  tristeza: "Tristeza",
});

// Etiquetas humanas de los dominios cognitivos (fuente de verdad: tabla
// cognitive_domains del backend). Si llega un slug no listado se muestra el
// slug crudo — nunca "undefined".
export const DOMAIN_LABELS = Object.freeze({
  memoria: "Memoria",
  atencion: "Atención",
  funciones_ejecutivas: "Funciones ejecutivas",
  orientacion: "Orientación",
  comprension_lenguaje: "Comprensión y lenguaje",
});

export function formatDomainLabel(slug) {
  if (typeof slug !== "string" || slug.length === 0) return "";
  return DOMAIN_LABELS[slug] || slug;
}

/**
 * Devuelve lista única y ordenada de etiquetas humanas de los dominios
 * trabajados en una sesión, a partir de un array de activities del backend.
 */
export function collectDomainLabels(activities) {
  if (!Array.isArray(activities)) return [];
  const seen = new Set();
  for (const a of activities) {
    const slugs = Array.isArray(a?.cognitive_domain_slugs) ? a.cognitive_domain_slugs : [];
    for (const s of slugs) if (typeof s === "string" && s.length > 0) seen.add(s);
  }
  return [...seen].map(formatDomainLabel).sort();
}

/**
 * Devuelve lista de nombres humanos de las actividades realizadas. Si una
 * actividad trae name directo (del backend) usa ese; si no, resuelve por slug.
 */
export function collectActivityLabels(activities) {
  if (!Array.isArray(activities)) return [];
  return activities
    .map((a) => (typeof a?.name === "string" && a.name.length > 0 ? a.name : formatSectionLabel(a?.slug)))
    .filter((n) => typeof n === "string" && n.length > 0);
}

/**
 * Extrae una métrica desde el array `evidence` según scope y nombre. Devuelve
 * el valor (number|string|null) o undefined si la métrica no está. Útil para
 * renderizar tiles sin depender del orden que use el backend.
 */
export function findEvidenceValue(evidence, { scope, metric, sectionSlug } = {}) {
  if (!Array.isArray(evidence)) return undefined;
  for (const e of evidence) {
    if (!e || typeof e !== "object") continue;
    if (scope && e.scope !== scope) continue;
    if (metric && e.metric !== metric) continue;
    if (sectionSlug && e.section_slug !== sectionSlug) continue;
    return e.value;
  }
  return undefined;
}

/**
 * Devuelve los tiles globales de la sesión listos para render. Orden fijo
 * para legibilidad. Métricas ausentes se omiten (no se muestran como "—"
 * innecesariamente), excepto mood que siempre se muestra ("No registrado"
 * cuando el valor es null).
 */
export function buildGlobalMetricTiles(evidence) {
  if (!Array.isArray(evidence)) return [];
  const tiles = [];
  const push = (metric, labelOverride) => {
    const value = findEvidenceValue(evidence, { scope: "global", metric });
    if (value === undefined) return;
    tiles.push({
      metric,
      label: labelOverride || formatMetricLabel(metric),
      value: formatMetricValue(metric, value),
    });
  };
  push("total_questions");
  push("correct_answers");
  push("incorrect_answers");
  push("accuracy");
  push("completion_rate");
  push("mean_latency_ms");
  const duration = findEvidenceValue(evidence, { scope: "session", metric: "duration_seconds" });
  if (duration !== undefined) {
    tiles.push({
      metric: "duration_seconds",
      label: formatMetricLabel("duration_seconds"),
      value: formatMetricValue("duration_seconds", duration),
    });
  }
  return tiles;
}

/**
 * Devuelve el valor de mood listo para render: siempre un objeto
 * { label, isRegistered }. Nunca inventa estado.
 */
export function resolveReportedMood(evidence) {
  const value = findEvidenceValue(evidence, { scope: "session", metric: "patient_reported_mood" });
  if (value === undefined) {
    return { label: "No registrado", isRegistered: false };
  }
  if (value === null) {
    return { label: "No registrado", isRegistered: false };
  }
  const formatted = formatMetricValue("patient_reported_mood", value);
  if (!formatted || formatted === "—") {
    return { label: "No registrado", isRegistered: false };
  }
  return { label: formatted, isRegistered: true };
}

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
  // Mood: valor string, no numérico. "—" si no está en la whitelist (evita
  // mostrar un slug crudo al profesional).
  if (metric === "patient_reported_mood") {
    if (typeof value !== "string") return "—";
    return MOOD_LABELS[value] || "—";
  }
  // Duración: valor en segundos. Formato "1 min 9 s" cuando ≥ 60; "N s" si no.
  if (metric === "duration_seconds") {
    if (!Number.isFinite(Number(value))) return "—";
    const total = Math.round(Number(value));
    if (total < 60) return `${total} s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `${m} min` : `${m} min ${s} s`;
  }
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
  // v2.3: nuevo scope "session" para campos de la sesión (duración, mood).
  // Se renderiza bajo el mismo grupo "General" para no fragmentar la vista.
  let scope;
  if (entry?.scope === "section") scope = "section";
  else if (entry?.scope === "session") scope = "session";
  else scope = "global";
  const sectionSlug = scope === "section" && typeof entry?.section_slug === "string"
    ? entry.section_slug
    : null;
  const group = scope === "section" ? formatSectionLabel(sectionSlug) : "General";
  return {
    scope,
    sectionSlug,
    group,
    metricLabel: formatMetricLabel(entry?.metric),
    valueLabel: formatMetricValue(entry?.metric, entry?.value),
  };
}

// v2.4 (BUG-11): comparación determinística persistida por el backend.
// Fuente: analysis.comparison_metrics (ver comparisonBuilder.js).
// Devuelve filas listas para render:
//   [{ metric, label, text }]
// `text` describe la métrica actual + previa + delta + dirección en formato
// humano. No incluye interpretación clínica — es puro reporte factual.
const DIRECTION_LABELS = Object.freeze({
  subió: "subió",
  bajó: "bajó",
  igual: "sin cambios",
  sin_datos: "sin datos para comparar",
});

function fmtPercentFromRatio(ratio) {
  if (!Number.isFinite(Number(ratio))) return "—";
  return `${(Number(ratio) * 100).toFixed(1).replace(".", ",")} %`;
}
function fmtPP(deltaPP) {
  if (!Number.isFinite(Number(deltaPP))) return "—";
  const n = Number(deltaPP);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1).replace(".", ",")} pp`;
}
function fmtMsHuman(ms) {
  if (!Number.isFinite(Number(ms))) return "—";
  const n = Number(ms);
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2).replace(".", ",")} s`;
}
function fmtMsDelta(deltaMs) {
  if (!Number.isFinite(Number(deltaMs))) return "—";
  const n = Number(deltaMs);
  const sign = n > 0 ? "+" : "";
  if (Math.abs(n) < 1000) return `${sign}${Math.round(n)} ms`;
  return `${sign}${(n / 1000).toFixed(2).replace(".", ",")} s`;
}

// P1 (mecanismo adaptativo): describe el nivel de dificultad de ambas
// sesiones. Devuelve null cuando la comparación es anterior al mecanismo.
function formatDifficultyLevelRow(level) {
  if (!level || typeof level !== "object") return null;
  const fmt = (v) => (Number.isInteger(v) ? `nivel ${v}` : "sin nivel registrado");
  let note;
  if (level.same === true) note = "Ambas sesiones tienen el mismo nivel de dificultad.";
  else if (level.same === false) note = "Las sesiones tienen distinto nivel de dificultad: la variación de precisión no es directamente comparable.";
  else note = "Una de las sesiones no tiene nivel de dificultad registrado: la variación de precisión no es directamente comparable.";
  return {
    metric: "difficulty_level",
    label: "Nivel de dificultad",
    text: `Actual ${fmt(level.current)}, anterior ${fmt(level.previous)}. ${note}`,
  };
}

export function formatComparisonMetrics(cm) {
  if (!cm || typeof cm !== "object") return [];
  const rows = [];
  const levelRow = formatDifficultyLevelRow(cm.difficulty_level);
  if (levelRow) rows.push(levelRow);
  const levelsComparable = !cm.difficulty_level || cm.difficulty_level.same === true;
  if (cm.accuracy && cm.accuracy.direction) {
    const dirLabel = levelsComparable
      ? DIRECTION_LABELS[cm.accuracy.direction] || cm.accuracy.direction
      : "no directamente comparable";
    rows.push({
      metric: "accuracy",
      label: "Precisión",
      text: `Actual ${fmtPercentFromRatio(cm.accuracy.current)}, anterior ${fmtPercentFromRatio(cm.accuracy.previous)} — variación ${fmtPP(cm.accuracy.delta_percentage_points)} (${dirLabel}).`,
    });
  }
  if (cm.completion_rate && cm.completion_rate.direction) {
    const dirLabel = DIRECTION_LABELS[cm.completion_rate.direction] || cm.completion_rate.direction;
    rows.push({
      metric: "completion_rate",
      label: "Completitud",
      text: `Actual ${fmtPercentFromRatio(cm.completion_rate.current)}, anterior ${fmtPercentFromRatio(cm.completion_rate.previous)} — variación ${fmtPP(cm.completion_rate.delta_percentage_points)} (${dirLabel}).`,
    });
  }
  if (cm.mean_latency_ms && cm.mean_latency_ms.direction) {
    const dirLabel = DIRECTION_LABELS[cm.mean_latency_ms.direction] || cm.mean_latency_ms.direction;
    rows.push({
      metric: "mean_latency_ms",
      label: "Tiempo medio de respuesta",
      text: `Actual ${fmtMsHuman(cm.mean_latency_ms.current)}, anterior ${fmtMsHuman(cm.mean_latency_ms.previous)} — variación ${fmtMsDelta(cm.mean_latency_ms.delta_ms)} (${dirLabel}).`,
    });
  }
  return rows;
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
