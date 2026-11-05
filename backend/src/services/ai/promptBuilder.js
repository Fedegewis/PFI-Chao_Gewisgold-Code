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
//      2) Los datos llegan ya repartidos en un bloque por párrafo.
//      3) Los aspectos se piden sobre TEMAS determinísticos (un dato
//         registrado por tema): el modelo los redacta, no decide qué merece
//         atención. Se validan igual que el summary y los que no cumplen se
//         descartan uno por uno (aspectsPolicy "filter").
//      4) El estado de ánimo se puede mencionar sólo como algo que la persona
//         informó y sin relacionarlo con los resultados.
//    Ajuste final de 3.6 (antes de desplegarse; la primera versión quedó
//    congelada en scripts/eval/legacyPromptV36a.js):
//      5) Las observaciones automáticas YA NO se envían al modelo. El panel
//         las muestra aparte y el 3B las copiaba textuales (en la evaluación,
//         todas las síntesis aceptadas las contenían palabra por palabra).
//         Siguen usándose para validar el anclaje.
//      6) Lo indispensable de esas observaciones (resultado general,
//         preguntas sin responder, comparación con la sesión anterior) llega
//         como oraciones propias de sessionFacts, con otra redacción. Se
//         probaron fichas "Etiqueta: valor" para forzar redacción propia: el
//         3B pasaba a interpretar los datos ("sugiere una buena capacidad",
//         "avance en la capacidad cognitiva"). Con oraciones se ciñe a ellas,
//         así que los datos siguen llegando como oraciones.
//      7) La cantidad de párrafos es proporcional a los datos: el párrafo de
//         contexto sólo existe si hay nivel o estado de ánimo, y el de
//         antecedentes sólo si hay sesiones anteriores.
//      8) Junto al prompt se arma un JSON Schema (outputSchema) que Ollama
//         usa como gramática (structured outputs): fija la cantidad exacta de
//         párrafos, el máximo de puntos y el largo de cada texto. El
//         validador posterior sigue siendo obligatorio.
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

// Largos que se imponen por gramática. El validador admite hasta 1100 por
// párrafo y 240 por aspecto; la gramática corta antes para que un bucle de
// repetición no consuma todo num_predict (observado: 900 tokens, 126 s, en la
// evaluación de la primera versión de 3.6). Un tope de 700 cortaba párrafos
// legítimos a mitad de oración (rechazo malformed_summary): se usa 1000. El
// mínimo evita párrafos de relleno (un salto de línea suelto) para completar
// la cantidad.
export const OUTPUT_PARAGRAPH_MAX_CHARS = 1000;
export const OUTPUT_ASPECT_MAX_CHARS = 240;
const OUTPUT_ASPECTS_MAX = 5;

const ROLE = [
  "Redactás un informe descriptivo para la psicóloga o el psicólogo que acompaña a una persona mayor en su entrenamiento cognitivo con MenteActiva.",
  "Los datos de la sesión figuran más abajo, repartidos en bloques: fueron calculados por el sistema a partir de las respuestas y son exactos.",
].join(" ");

const GUIDE_INTRO = [
  "Cómo escribir el informe:",
  "1. \"paragraphs\": escribí un párrafo por cada bloque PÁRRAFO, en el mismo orden, usando sólo las oraciones de ese bloque. Redactalas como prosa conectada, en español rioplatense y con tono profesional, conservando el sentido y la dirección de cada dato. Podés unir oraciones y agrupar los tipos de preguntas que tuvieron el mismo resultado. Nombrá la actividad tal como figura, sin comillas.",
  "2. Cada oración del informe cuenta un dato registrado. Los objetivos de la actividad, las explicaciones, las causas, las valoraciones y las conclusiones sobre la persona corresponden al profesional: dejalos fuera del informe.",
];
// Sólo cuando hay un estado de ánimo registrado: con la regla y sin el dato,
// el 3B lo inventaba.
const GUIDE_MOOD = "Contá el estado de ánimo como lo que la persona informó al comenzar, en una oración propia, sin unirlo a los resultados ni a los tiempos.";
const GUIDE_NOT_COMPARABLE = "Si un dato dice que una comparación no es directamente comparable, decilo de esa forma.";
const GUIDE_NUMBERS = "No escribas números ni porcentajes: el sistema muestra las cifras por separado.";
const GUIDE_ASPECTS = "\"aspects_to_review\": escribí un punto por cada tema del bloque TEMAS PARA SEGUIMIENTO, de una sola oración. Cada punto tiene esta forma: Observar (o Registrar, o Revisar) + el tema + en las próximas sesiones. No agregues para qué ni qué se espera encontrar.";

function writingGuide({ hasMood, hasTopics }) {
  const rest = [
    ...(hasMood ? [GUIDE_MOOD] : []),
    GUIDE_NOT_COMPARABLE,
    GUIDE_NUMBERS,
    ...(hasTopics ? [GUIDE_ASPECTS] : []),
  ];
  return [...GUIDE_INTRO, ...rest.map((r, i) => `${i + 3}. ${r}`)].join("\n");
}

// La plantilla muestra exactamente tantos párrafos y puntos como bloques y
// temas hay: con una plantilla de dos párrafos y tres bloques, el 3B escribía
// el tercer párrafo como una clave JSON nueva.
function outputInstruction(paragraphCount, topicCount) {
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => `"<párrafo ${i + 1}>"`).join(", ");
  const aspects = Array.from({ length: topicCount }, (_, i) => `"<punto ${i + 1}>"`).join(", ");
  return [
    "FORMATO DE RESPUESTA: devolvé únicamente un objeto JSON, sin texto antes ni después y sin bloque de código, con exactamente estos tres campos:",
    `{"schema_version": "${OUTPUT_SCHEMA_VERSION}", "paragraphs": [${paragraphs}], "aspects_to_review": [${aspects}]}`,
  ].join("\n");
}

/**
 * JSON Schema de la salida (structured outputs de Ollama, campo `format`).
 * La gramática garantiza la forma; el contenido lo sigue revisando el
 * validador (responseValidator + contentSafety).
 */
export function buildOutputSchema(paragraphCount, topicCount) {
  const n = Math.max(1, Math.min(4, paragraphCount));
  const t = Math.max(0, Math.min(OUTPUT_ASPECTS_MAX, topicCount));
  return {
    type: "object",
    properties: {
      schema_version: { type: "string", enum: [OUTPUT_SCHEMA_VERSION] },
      paragraphs: {
        type: "array",
        items: { type: "string", minLength: 20, maxLength: OUTPUT_PARAGRAPH_MAX_CHARS },
        minItems: n,
        maxItems: n,
      },
      aspects_to_review: {
        type: "array",
        items: { type: "string", minLength: 20, maxLength: OUTPUT_ASPECT_MAX_CHARS },
        minItems: 0,
        maxItems: t,
      },
    },
    required: ["schema_version", "paragraphs", "aspects_to_review"],
    additionalProperties: false,
  };
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
 * @param {object}   [extra.facts]         Salida de sessionFacts.buildSessionFacts.
 * @param {string[]} [extra.observations]  Sólo se usan si faltan los hechos
 *   enriquecidos; con hechos NO se envían al modelo.
 * @returns {{ prompt: string, promptVersion: string, paragraphCount: number,
 *             topicCount: number, outputSchema: object }}
 */
export function buildSessionAnalysisPrompt(context, extra = {}) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    throw new TypeError("context.sections vacío");
  }

  const blocks = extra.facts?.blocks || {};
  const hasFacts = Boolean(extra.facts?.blocks);

  // Sin comillas: con format=json, si el modelo copia una comilla doble la
  // gramática de Ollama cierra el string (ver contentSafety.findMalformedSummary).
  const activities = Array.isArray(blocks.activities) && blocks.activities.length > 0
    ? blocks.activities
    : context.sections.map((s) => ({ name: s.name, description: null }));
  const activityLines = activities.map((a) => (a.description
    ? `La persona realizó la actividad ${a.name}, que propone ${a.description}.`
    : `La persona realizó la actividad ${a.name}.`));
  const contextLines = [
    ...(blocks.level ? [`Las preguntas correspondieron al nivel de dificultad ${blocks.level}.`] : []),
    // "bien" es un adverbio: "informó sentirse bien", no "sentir bien".
    ...(blocks.mood ? [`Al comenzar, la persona informó ${blocks.mood === "bien" ? "sentirse" : "sentir"} ${blocks.mood}.`] : []),
  ];

  let resultLines;
  let historyLines;
  if (hasFacts) {
    resultLines = [...(blocks.general || []), ...(blocks.types || []), ...(blocks.times || [])];
    historyLines = blocks.history || [];
  } else {
    // Sin hechos enriquecidos (no ocurre en los dos caminos de generación):
    // se usan las observaciones para no dejar el bloque vacío.
    const observations = Array.isArray(extra.observations) ? extra.observations : [];
    resultLines = observations.length > 0 ? observations : ["La sesión fue registrada."];
    historyLines = [];
  }
  resultLines = resultLines.map(sentence);
  historyLines = historyLines.map(sentence);

  // Párrafos proporcionales a los datos.
  const paragraphs = [];
  if (contextLines.length > 0) {
    paragraphs.push({ title: "la actividad y el comienzo de la sesión", lines: [...activityLines, ...contextLines] });
    paragraphs.push({ title: "los resultados y los tiempos", lines: resultLines });
  } else {
    paragraphs.push({ title: "la actividad, los resultados y los tiempos", lines: [...activityLines, ...resultLines] });
  }
  if (historyLines.length > 0) {
    paragraphs.push({ title: "las sesiones anteriores", lines: historyLines });
  }
  const topics = (Array.isArray(blocks.topics) ? blocks.topics : []).slice(0, OUTPUT_ASPECTS_MAX);

  const data = [];
  paragraphs.forEach((p, i) => {
    if (i > 0) data.push("");
    data.push(`PÁRRAFO ${i + 1} (${p.title}):`, ...bullet(p.lines));
  });
  if (topics.length > 0) data.push("", "TEMAS PARA SEGUIMIENTO:", ...bullet(topics));

  const prompt = [
    ROLE,
    "",
    writingGuide({ hasMood: Boolean(blocks.mood), hasTopics: topics.length > 0 }),
    "",
    ...data,
    "",
    outputInstruction(paragraphs.length, topics.length),
  ].join("\n");

  return {
    prompt,
    promptVersion: PROMPT_VERSION,
    paragraphCount: paragraphs.length,
    topicCount: topics.length,
    outputSchema: buildOutputSchema(paragraphs.length, topics.length),
  };
}

export const PROMPT_BUILDER_VERSION = PROMPT_VERSION;
export const PROMPT_OUTPUT_SCHEMA_VERSION = OUTPUT_SCHEMA_VERSION;
