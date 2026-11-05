// COPIA CONGELADA de promptBuilder.js del prompt 3.6 inicial (commit ed4d920).
// Sólo para la evaluación comparativa (scripts/eval/eval-prompts.js).

// Prompt Builder — v3.6 (recuperar profundidad sin perder seguridad, 2026-11-05).
//
// Historia breve:
//  - v3.0-3.3: el modelo recibe un contexto mínimo (nombres de actividades)
//    y devuelve summary + aspects_to_review. Sin métricas crudas.
//  - v3.4: se agrega un bloque OBSERVATIONS con frases determinísticas para
//    que el modelo las parafrasee. Pide summary (1-2 oraciones) + aspects.
//  - v3.5: reglas en positivo (el 3B copiaba los términos prohibidos que la
//    regla enumeraba), HECHOS REGISTRADOS como única fuente y ya NO pide
//    aspects_to_review (concentraba la especulación). Resultado: una o dos
//    oraciones que repiten las observaciones automáticas, sin aspectos.
//    Copia congelada en scripts/eval/legacyPromptV35.js.
//  - v3.6 (este archivo). Diagnóstico: la falta de profundidad no venía del
//    modelo sino de lo que recibía. Ni 3.4 ni 3.5 le pasaban estado de ánimo,
//    nivel, tiempos, tipos de preguntas ni antecedentes; con sólo las
//    observaciones, lo único posible era parafrasearlas.
//      1) El modelo recibe datos construidos por sessionFacts.js: descripción
//         de la actividad, nivel de dificultad, estado de ánimo informado,
//         resultado por tipo de pregunta, tiempos descriptos por comparación
//         interna y antecedentes. Todo en palabras y sin cifras.
//      2) Los datos llegan ya repartidos en un bloque por párrafo. Con un
//         ejemplo de estilo completo el 3B copiaba contenido del ejemplo
//         (estado de ánimo inexistente, "no hay sesiones comparables" cuando
//         sí las había); sin ejemplo y con una sola lista de datos agregaba
//         explicaciones propias. Con un bloque por párrafo la tarea se reduce
//         a redactar en prosa lo que ya está en ese bloque.
//      3) Los aspectos vuelven a pedirse, pero sobre TEMAS determinísticos
//         (un dato registrado por tema): el modelo los redacta, no decide qué
//         merece atención. Se validan igual que el summary (familias, cifras,
//         anclaje, contradicción con los hechos) y los que no cumplen se
//         descartan uno por uno (aspectsPolicy "filter").
//      4) El estado de ánimo se puede mencionar sólo como algo que la persona
//         informó y sin relacionarlo con los resultados (contentSafety valida
//         el valor registrado y la ausencia de conectores causales).
//    Las reglas siguen redactadas en positivo y sin nombrar términos
//    clínicos que el modelo pueda copiar.
//
// Qué devuelve el modelo:
//   { "schema_version": "3", "paragraphs": ["...", "..."], "aspects_to_review": ["...", ...] }
// El análisis persistido sigue siendo schema "3" con `summary` (compatible
// con la API, el panel y los análisis anteriores).
//
// Función pura: no llama Ollama, no lee env, no toca DB.

const PROMPT_VERSION = "3.6";
const OUTPUT_SCHEMA_VERSION = "3";

const ROLE = [
  "Redactás un informe descriptivo para la psicóloga o el psicólogo que acompaña a una persona mayor en su entrenamiento cognitivo con MenteActiva.",
  "Los datos de la sesión figuran más abajo, repartidos en bloques: fueron calculados por el sistema a partir de las respuestas y son exactos.",
].join(" ");

const GUIDE_INTRO = [
  "Cómo escribir el informe:",
  "1. \"paragraphs\": escribí un párrafo por cada bloque PÁRRAFO, en el mismo orden, usando sólo las oraciones de ese bloque. Redactalas como prosa conectada, en español rioplatense y con tono profesional, conservando el sentido y la dirección de cada dato. Podés unir oraciones y agrupar los tipos de preguntas que tuvieron el mismo resultado. Nombrá la actividad tal como figura, sin comillas.",
  "2. Cada oración del informe cuenta un dato registrado. Las explicaciones, las causas, las valoraciones y las conclusiones sobre la persona corresponden al profesional: dejalas fuera del informe.",
];
// Sólo cuando hay un estado de ánimo registrado: con la regla y sin el dato,
// el 3B lo inventaba.
const GUIDE_MOOD = "Contá el estado de ánimo como lo que la persona informó al comenzar, en una oración propia, sin unirlo a los resultados ni a los tiempos.";
const GUIDE_NOT_COMPARABLE = "Si un dato dice que una comparación no es directamente comparable, decilo de esa forma.";
const GUIDE_NUMBERS = "No escribas números ni porcentajes: el sistema muestra las cifras por separado.";
const GUIDE_ASPECTS = "\"aspects_to_review\": escribí un punto por cada tema del bloque TEMAS PARA SEGUIMIENTO, de una sola oración. Cada punto empieza con Observar, Registrar, Revisar o Comparar, nombra el dato del tema y dice qué mirar en las próximas sesiones.";

function writingGuide({ hasMood }) {
  const rest = [...(hasMood ? [GUIDE_MOOD] : []), GUIDE_NOT_COMPARABLE, GUIDE_NUMBERS, GUIDE_ASPECTS];
  return [...GUIDE_INTRO, ...rest.map((r, i) => `${i + 3}. ${r}`)].join("\n");
}

// La plantilla muestra exactamente tantos párrafos y puntos como bloques y
// temas hay: con una plantilla de dos párrafos y tres bloques, el 3B escribía
// el tercer párrafo como una clave JSON nueva.
function outputInstruction(paragraphCount, topicCount) {
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => `"<párrafo ${i + 1}>"`).join(", ");
  const aspects = Array.from({ length: Math.max(1, topicCount) }, (_, i) => `"<punto ${i + 1}>"`).join(", ");
  return [
    "FORMATO DE RESPUESTA: devolvé únicamente un objeto JSON, sin texto antes ni después y sin bloque de código, con exactamente estos tres campos:",
    `{"schema_version": "${OUTPUT_SCHEMA_VERSION}", "paragraphs": [${paragraphs}], "aspects_to_review": [${aspects}]}`,
  ].join("\n");
}

function bullet(lines) {
  return lines.map((l) => `- ${l}`);
}

function sentence(text) {
  const t = String(text).trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Construye el prompt que se envía a Ollama (v3.6).
 *
 * @param {object} context     Salida de buildSessionAnalysisContext.
 * @param {object} [extra]
 * @param {string[]} [extra.observations]  Hechos determinísticos (observationsBuilder).
 * @param {object}   [extra.facts]         Salida de sessionFacts.buildSessionFacts.
 * @returns {{ prompt: string, promptVersion: string }}
 */
export function buildSessionAnalysisPrompt(context, extra = {}) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    throw new TypeError("context.sections vacío");
  }

  const observations = Array.isArray(extra.observations) ? extra.observations : [];
  const blocks = extra.facts?.blocks || {};

  // Sin comillas: con format=json, si el modelo copia una comilla doble la
  // gramática de Ollama cierra el string (ver contentSafety.findMalformedSummary).
  const activities = Array.isArray(blocks.activities) && blocks.activities.length > 0
    ? blocks.activities
    : context.sections.map((s) => ({ name: s.name, description: null }));
  const activityLines = activities.map((a) => (a.description
    ? `La persona realizó la actividad ${a.name}, que propone ${a.description}.`
    : `La persona realizó la actividad ${a.name}.`));

  // Las observaciones determinísticas se reparten: las comparativas van al
  // párrafo de antecedentes y el resto al de resultados.
  const isHistory = (o) => /sesi[oó]n(es)? (anterior|comparable)|sesiones comparables/i.test(o);
  const resultLines = observations.filter((o) => !isHistory(o));
  const historyLines = [...(blocks.history || []), ...observations.filter(isHistory)];

  const p1 = [
    ...activityLines,
    ...(blocks.level ? [`Las preguntas correspondieron al nivel de dificultad ${blocks.level}.`] : []),
    // "bien" es un adverbio: "informó sentirse bien", no "sentir bien".
    ...(blocks.mood ? [`Al comenzar, la persona informó ${blocks.mood === "bien" ? "sentirse" : "sentir"} ${blocks.mood}.`] : []),
  ];
  const p2 = [
    ...(resultLines.length > 0 ? resultLines : ["La sesión fue registrada."]),
    ...(blocks.types || []),
    ...(blocks.times || []),
  ].map(sentence);
  const p3 = historyLines.map(sentence);
  const topics = Array.isArray(blocks.topics) ? blocks.topics : [];

  const data = [
    "PÁRRAFO 1 (la actividad y el comienzo de la sesión):",
    ...bullet(p1),
    "",
    "PÁRRAFO 2 (los resultados y los tiempos):",
    ...bullet(p2),
    ...(p3.length > 0 ? ["", "PÁRRAFO 3 (los antecedentes):", ...bullet(p3)] : []),
    ...(topics.length > 0 ? ["", "TEMAS PARA SEGUIMIENTO:", ...bullet(topics)] : []),
  ];

  const prompt = [
    ROLE,
    "",
    writingGuide({ hasMood: Boolean(blocks.mood) }),
    "",
    ...data,
    "",
    outputInstruction(p3.length > 0 ? 3 : 2, topics.length),
  ].join("\n");

  return { prompt, promptVersion: PROMPT_VERSION };
}

export const PROMPT_BUILDER_VERSION = PROMPT_VERSION;
export const PROMPT_OUTPUT_SCHEMA_VERSION = OUTPUT_SCHEMA_VERSION;
