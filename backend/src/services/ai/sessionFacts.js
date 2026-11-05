// v3.6 — Hechos de sesión enriquecidos para el informe IA.
//
// Motivación (2026-11-05): con los prompts 3.4/3.5 el modelo sólo recibía el
// nombre de la actividad y las observaciones determinísticas (completitud,
// distribución de respuestas, comparación). Con eso no puede escribir más que
// una paráfrasis de esas mismas frases: la síntesis repetía las
// observaciones automáticas y no aportaba nada al profesional.
//
// Este módulo traduce a PALABRAS (sin cifras) datos que el backend ya tiene:
//   - qué propone la actividad (texto fijo por actividad),
//   - el nivel de dificultad con el que se armó (mecanismo adaptativo),
//   - el estado de ánimo que la persona informó al iniciar,
//   - el resultado por tipo de pregunta (subdimensión) y según si la pregunta
//     tenía información previa que luego se oculta (stimulus),
//   - los tiempos de respuesta descriptos por comparación interna
//     (correctas vs. incorrectas, tipo de pregunta con el mayor tiempo),
//   - si existen sesiones anteriores de la misma actividad.
//
// Reglas:
//   - Ninguna frase contiene cifras: el modelo no puede repetir lo que no ve
//     y el panel ya muestra los números.
//   - No hay umbrales clínicos. Las únicas comparaciones son aritméticas
//     (mayor/menor/igual) y, para tiempos, se reutiliza la cota de ruido
//     práctica de comparisonBuilder (no es una interpretación clínica).
//   - No se transmite el texto de las preguntas, las opciones, la respuesta
//     elegida ni datos personales.
//   - Junto a las frases se devuelve una ficha estructurada (`sheet`) para que
//     el validador verifique que el texto del modelo no las contradiga.
//
// Función pura: sin DB, sin red, sin process.env.

import { COMPARISON_THRESHOLDS } from "./comparisonBuilder.js";

export const SESSION_FACTS_VERSION = "3.6";

// Qué propone cada actividad, en términos de la tarea (no de capacidades).
export const ACTIVITY_DESCRIPTIONS = Object.freeze({
  memoria_de_trabajo: "preguntas sobre los productos de una lista de compras",
  atencion_y_calculo: "preguntas sobre pagos, montos y cambio en situaciones de traslado",
  funciones_ejecutivas: "preguntas sobre el orden de los pasos de una receta y de tareas cotidianas",
  orientacion_temporal: "preguntas sobre fechas, horarios y turnos de una agenda",
  memoria_asociativa: "preguntas que asocian personas con nombres y datos simples",
  metacognicion: "preguntas sobre la propia organización y la percepción de las tareas cotidianas",
  memoria_prospectiva: "preguntas sobre recordatorios e instrucciones de una rutina de medicación indicada previamente",
  atencion_visual: "preguntas sobre objetos de uso cotidiano, su función y su ubicación en el hogar",
  comprension_funcional: "preguntas sobre mensajes, llamadas y avisos cotidianos",
  orientacion_espacial: "preguntas sobre recorridos y referencias del barrio",
});

// Tipos de pregunta (questions.subdimension). `label` es lo que ve el modelo;
// `keys` son las palabras (normalizadas) con las que el validador reconoce
// que una oración habla de ese tipo. Se evita lenguaje de capacidades
// ("flexibilidad cognitiva" → "cambio de criterio").
export const QUESTION_TYPES = Object.freeze({
  reconocimiento_funcional: { label: "reconocimiento del uso de objetos", keys: ["reconocimiento del uso", "uso de objetos"] },
  asociacion_objeto_lugar: { label: "asociación entre objetos y lugares", keys: ["objetos y lugares", "asociacion entre objetos"] },
  categorizacion_funcional: { label: "agrupamiento de objetos por su función", keys: ["agrupamiento"] },
  atencion_selectiva: { label: "búsqueda de un elemento entre varios", keys: ["busqueda de un elemento", "entre varios"] },
  discriminacion_funcional: { label: "distinción de objetos por su función", keys: ["distincion de objetos"] },
  deteccion_de_anomalia: { label: "detección de un elemento fuera de lugar", keys: ["fuera de lugar"] },
  atencion_sostenida: { label: "seguimiento de una serie de elementos", keys: ["serie de elementos"] },
  rastreo_de_atributos: { label: "identificación de características de objetos", keys: ["caracteristicas de objetos", "identificacion de caracteristicas"] },
  retencion_de_escena: { label: "recuerdo de una escena presentada", keys: ["escena"] },
  memoria_de_ubicacion: { label: "recuerdo de la ubicación de objetos", keys: ["ubicacion de objetos", "ubicacion de los objetos"] },
  memoria_de_secuencia: { label: "recuerdo del orden de una secuencia", keys: ["secuencia"] },
  deteccion_de_cambio: { label: "detección de cambios en una escena", keys: ["deteccion de cambios", "deteccion de un cambio"] },
  discriminacion_entre_similares: { label: "distinción entre elementos parecidos", keys: ["elementos parecidos"] },
  retencion_y_evocacion: { label: "recuerdo de información presentada", keys: ["recuerdo de informacion", "recuerdo de la informacion"] },
  actualizacion_de_memoria: { label: "actualización de una lista cuando cambia", keys: ["actualizacion"] },
  calculo_funcional: { label: "cálculos de la vida cotidiana", keys: ["calculo", "calculos"] },
  estimacion_y_redondeo: { label: "estimación y redondeo de montos", keys: ["estimacion", "redondeo"] },
  comparacion_y_seleccion: { label: "comparación y elección entre alternativas", keys: ["eleccion entre alternativas", "entre alternativas"] },
  comprension_funcional: { label: "comprensión de mensajes e instrucciones", keys: ["comprension de mensajes", "mensajes e instrucciones"] },
  planificacion_secuencial: { label: "ordenamiento de pasos", keys: ["ordenamiento"] },
  juicio_y_resolucion: { label: "resolución de situaciones cotidianas", keys: ["resolucion de situaciones", "situaciones cotidianas"] },
  estrategia_y_autorregulacion: { label: "organización y estrategias personales", keys: ["estrategias personales", "organizacion y estrategias"] },
  automonitoreo: { label: "revisión de las propias respuestas", keys: ["propias respuestas"] },
  reconocimiento_de_dificultad: { label: "percepción de la exigencia de una tarea", keys: ["exigencia de una tarea", "percepcion de la exigencia"] },
  flexibilidad_cognitiva: { label: "cambio de criterio", keys: ["cambio de criterio"] },
  inhibicion_de_respuesta: { label: "evitar una respuesta automática", keys: ["respuesta automatica"] },
  orientacion_temporal: { label: "fechas, horarios y turnos", keys: ["fechas, horarios", "fechas y horarios"] },
  orientacion_espacial: { label: "recorridos y referencias del lugar", keys: ["recorridos", "referencias del lugar"] },
});

export const LEVEL_LABELS = Object.freeze({
  1: "más accesible",
  2: "intermedio",
  3: "más exigente",
});

// Valores del CHECK de sessions.patient_reported_mood → cómo se nombran.
export const MOOD_LABELS = Object.freeze({
  alegria: "alegría",
  bien: "bien",
  calma: "calma",
  cansancio: "cansancio",
  tristeza: "tristeza",
});

const LATENCY_NOISE_MS = COMPARISON_THRESHOLDS.latency_ms;

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Normaliza las filas por pregunta que entrega loadSessionAnalysisInput.
 * Descarta silenciosamente filas mal formadas (el informe es complementario:
 * nunca debe impedir el análisis).
 */
export function normalizeQuestionDetails(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const answered = r.answered === true;
    const isCorrect = r.is_correct === true ? true : r.is_correct === false ? false : null;
    const latency = toNum(r.response_time_ms);
    out.push({
      section_slug: typeof r.section_slug === "string" ? r.section_slug : null,
      subdimension: typeof r.subdimension === "string" && QUESTION_TYPES[r.subdimension] ? r.subdimension : null,
      has_stimulus: r.has_stimulus === true,
      answered,
      is_correct: answered ? isCorrect : null,
      response_time_ms: answered && latency !== null && latency > 0 ? latency : null,
    });
  }
  return out;
}

// Resultado de un grupo de preguntas, sin cifras.
function outcomeOf(group) {
  const answered = group.filter((q) => q.answered);
  const scored = answered.filter((q) => q.is_correct !== null);
  const correct = scored.filter((q) => q.is_correct).length;
  const incorrect = scored.length - correct;
  const unanswered = group.length - answered.length;
  let outcome;
  if (scored.length === 0) outcome = unanswered > 0 ? "unanswered" : "not_scored";
  else if (incorrect === 0) outcome = "all_correct";
  else if (correct === 0) outcome = "all_incorrect";
  else outcome = "mixed";
  return { outcome, unanswered: unanswered > 0, count: group.length, accuracy: scored.length ? correct / scored.length : null };
}

function outcomePhrase({ outcome, unanswered, count }) {
  const single = count === 1;
  let base;
  switch (outcome) {
    case "all_correct":
      base = single ? "la única pregunta de este tipo fue respondida correctamente" : "todas las respuestas fueron correctas";
      break;
    case "all_incorrect":
      base = single ? "la única pregunta de este tipo fue respondida de forma incorrecta" : "todas las respuestas fueron incorrectas";
      break;
    case "mixed":
      base = "hubo respuestas correctas e incorrectas";
      break;
    case "unanswered":
      return single ? "la única pregunta de este tipo quedó sin responder" : "las preguntas quedaron sin responder";
    default:
      return null;
  }
  return unanswered ? `${base}, y alguna quedó sin responder` : base;
}

function compareLatency(a, b) {
  if (a === null || b === null) return null;
  const d = a - b;
  if (Math.abs(d) < LATENCY_NOISE_MS) return "similar";
  return d > 0 ? "first_slower" : "first_faster";
}

/**
 * @param {object} context   Salida de buildSessionAnalysisContext.
 * @param {object} [details]
 * @param {Array}  [details.questionDetails]   Filas por pregunta (ver normalizeQuestionDetails).
 * @param {number|null} [details.adaptiveLevel]
 * @param {number} [details.sameActivityPreviousCount]
 * @returns {{ blocks: object, sentences: string[], sheet: object }}
 */
export function buildSessionFacts(context, details = {}) {
  if (!context || typeof context !== "object") throw new TypeError("context obligatorio");
  const sections = Array.isArray(context.sections) ? context.sections : [];
  const questions = normalizeQuestionDetails(details.questionDetails);

  // --- Actividad -----------------------------------------------------------
  const activities = sections.map((s) => ({
    name: s.name,
    description: ACTIVITY_DESCRIPTIONS[s.slug] || null,
  }));

  // --- Nivel ---------------------------------------------------------------
  const level = Number.isInteger(details.adaptiveLevel) && LEVEL_LABELS[details.adaptiveLevel]
    ? details.adaptiveLevel
    : null;
  const levelLabel = level ? LEVEL_LABELS[level] : null;

  // --- Estado de ánimo informado ------------------------------------------
  const mood = typeof context.patient_reported_mood === "string" && MOOD_LABELS[context.patient_reported_mood]
    ? context.patient_reported_mood
    : null;

  // --- Tipos de pregunta ---------------------------------------------------
  const byType = new Map();
  for (const q of questions) {
    if (!q.subdimension) continue;
    if (!byType.has(q.subdimension)) byType.set(q.subdimension, []);
    byType.get(q.subdimension).push(q);
  }
  const typeFacts = [];
  const typePhrases = [];
  const typeSheet = [];
  for (const [slug, group] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const o = outcomeOf(group);
    const phrase = outcomePhrase(o);
    if (!phrase) continue;
    const withStimulus = group.every((q) => q.has_stimulus);
    const withoutStimulus = group.every((q) => !q.has_stimulus);
    // Redactado como prosa: el 3B tiende a copiar los datos casi textuales,
    // así que el dato ya llega como una oración que se puede leer en el informe.
    const presentation = withStimulus
      ? ", que presentaban información previa que luego se ocultaba,"
      : withoutStimulus ? ", con la información a la vista," : "";
    typePhrases.push(phrase);
    const label = QUESTION_TYPES[slug].label;
    const singlePrefix = "la única pregunta de este tipo ";
    if (group.length === 1 && phrase.startsWith(singlePrefix)) {
      // "La única pregunta de X, con la información a la vista, fue respondida correctamente."
      const singlePresentation = withStimulus
        ? ", que presentaba información previa que luego se ocultaba,"
        : presentation;
      typeFacts.push(`La única pregunta de ${label}${singlePresentation} ${phrase.slice(singlePrefix.length)}.`);
    } else {
      typeFacts.push(`En las preguntas de ${label}${presentation} ${phrase}.`);
    }
    typeSheet.push({
      slug,
      keys: QUESTION_TYPES[slug].keys,
      outcome: o.outcome,
      presentation: withStimulus ? "stimulus" : withoutStimulus ? "visible" : "mixed",
    });
  }

  // Con información previa vs. a la vista: sólo si hay de ambas.
  const presentationFacts = [];
  let stimulusComparison = null;
  const stim = questions.filter((q) => q.has_stimulus);
  const noStim = questions.filter((q) => !q.has_stimulus);
  if (stim.length > 0 && noStim.length > 0) {
    const a = outcomeOf(stim).accuracy;
    const b = outcomeOf(noStim).accuracy;
    if (a !== null && b !== null) {
      stimulusComparison = a > b ? "stimulus_more_correct" : a < b ? "stimulus_less_correct" : "similar";
      presentationFacts.push(
        stimulusComparison === "similar"
          ? "Las preguntas con información previa que luego se oculta y las preguntas con la información a la vista tuvieron una proporción similar de respuestas correctas."
          : `En las preguntas con información previa que luego se oculta la proporción de respuestas correctas fue ${stimulusComparison === "stimulus_more_correct" ? "mayor" : "menor"} que en las preguntas con la información a la vista.`,
      );
    }
  }

  // --- Tiempos -------------------------------------------------------------
  const timeFacts = [];
  const timed = questions.filter((q) => q.response_time_ms !== null && q.is_correct !== null);
  const latCorrect = mean(timed.filter((q) => q.is_correct).map((q) => q.response_time_ms));
  const latIncorrect = mean(timed.filter((q) => !q.is_correct).map((q) => q.response_time_ms));
  const cmpLat = compareLatency(latIncorrect, latCorrect);
  let correctVsIncorrect = null;
  if (cmpLat === "first_slower") {
    correctVsIncorrect = "incorrect_slower";
    timeFacts.push("Las respuestas incorrectas llevaron en promedio más tiempo que las correctas.");
  } else if (cmpLat === "first_faster") {
    correctVsIncorrect = "correct_slower";
    timeFacts.push("Las respuestas correctas llevaron en promedio más tiempo que las incorrectas.");
  } else if (cmpLat === "similar") {
    correctVsIncorrect = "similar";
    timeFacts.push("Las respuestas correctas y las incorrectas llevaron en promedio un tiempo similar.");
  }

  let slowestType = null;
  if (byType.size >= 2) {
    const withTime = questions.filter((q) => q.subdimension && q.response_time_ms !== null);
    if (withTime.length > 0) {
      const max = Math.max(...withTime.map((q) => q.response_time_ms));
      const slowestTypes = new Set(withTime.filter((q) => q.response_time_ms === max).map((q) => q.subdimension));
      if (slowestTypes.size === 1) {
        slowestType = [...slowestTypes][0];
        timeFacts.push(`El mayor tiempo de respuesta de la sesión se registró en una pregunta de ${QUESTION_TYPES[slowestType].label}.`);
      }
    }
  }

  // --- Antecedentes --------------------------------------------------------
  const historyFacts = [];
  const prevCount = Number.isInteger(details.sameActivityPreviousCount) ? details.sameActivityPreviousCount : null;
  if (prevCount !== null && prevCount > 0) {
    historyFacts.push(
      prevCount === 1
        ? "Hay una sesión anterior registrada de esta misma actividad."
        : "Hay varias sesiones anteriores registradas de esta misma actividad.",
    );
  }

  // --- Temas para los puntos de seguimiento -------------------------------
  // Determinísticos: cada tema nombra un dato registrado de esta sesión. El
  // modelo redacta un punto por tema; no elige qué datos merecen atención.
  const topics = [];
  const presentationText = (p) => (p === "stimulus"
    ? " con información previa que luego se oculta"
    : p === "visible" ? " con la información a la vista" : "");
  const typeTopics = typeSheet.filter((t) => t.outcome !== "all_correct");
  for (const t of typeTopics) {
    const phrase = typePhrases[typeSheet.indexOf(t)];
    topics.push(`las preguntas de ${QUESTION_TYPES[t.slug].label}${presentationText(t.presentation)}, donde ${phrase}`);
  }
  if (stimulusComparison && stimulusComparison !== "similar") {
    topics.push("los resultados de las preguntas con información previa que luego se oculta frente a los de las preguntas con la información a la vista");
  }
  if (correctVsIncorrect === "incorrect_slower" || correctVsIncorrect === "correct_slower") {
    topics.push(correctVsIncorrect === "incorrect_slower"
      ? "el tiempo de las respuestas incorrectas, que fue en promedio mayor que el de las correctas"
      : "el tiempo de las respuestas correctas, que fue en promedio mayor que el de las incorrectas");
  }
  if (slowestType) {
    topics.push(`el tiempo de respuesta en las preguntas de ${QUESTION_TYPES[slowestType].label}`);
  }
  if (mood) {
    topics.push(`el estado de ánimo que la persona informe al iniciar la próxima sesión, junto al informado en esta (${MOOD_LABELS[mood]})`);
  }
  if (prevCount !== null && prevCount > 0) {
    topics.push("lo registrado en esta sesión frente a las sesiones anteriores de la misma actividad");
  }
  if (topics.length < 3) {
    for (const t of typeSheet.filter((x) => x.outcome === "all_correct")) {
      if (topics.length >= 3) break;
      topics.push(`las preguntas de ${QUESTION_TYPES[t.slug].label}${presentationText(t.presentation)}, donde todas las respuestas fueron correctas`);
    }
  }

  const blocks = {
    activities,
    level: levelLabel,
    mood: mood ? MOOD_LABELS[mood] : null,
    types: [...typeFacts, ...presentationFacts],
    times: timeFacts,
    history: historyFacts,
    topics: topics.slice(0, 5),
  };

  const sentences = [
    ...activities.filter((a) => a.description).map((a) => `${a.name}: ${a.description}.`),
    ...(levelLabel ? [`Nivel de dificultad de las preguntas: ${levelLabel}.`] : []),
    ...(mood ? [`Estado de ánimo informado por la persona al iniciar: ${MOOD_LABELS[mood]}.`] : []),
    ...blocks.types,
    ...timeFacts,
    ...historyFacts,
  ];

  const sheet = {
    version: SESSION_FACTS_VERSION,
    mood,
    level,
    types: typeSheet,
    stimulus_comparison: stimulusComparison,
    latency_correct_vs_incorrect: correctVsIncorrect,
    slowest_type: slowestType,
    same_activity_previous: prevCount === null ? null : prevCount > 0,
  };

  return { blocks, sentences, sheet };
}
