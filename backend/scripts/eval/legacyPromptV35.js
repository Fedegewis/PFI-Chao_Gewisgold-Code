// COPIA CONGELADA del prompt 3.5 (commit b18dc83). Sólo para la evaluación
// comparativa 3.4 vs 3.5 vs 3.6 (scripts/eval/eval-prompts.js). No se usa en producción.

// Prompt Builder — v3.5 (auditoría de seguridad del análisis IA, 2026-11-04).
//
// Historia breve:
//  - v3.0-3.3: el modelo recibe un contexto mínimo (nombres de actividades)
//    y devuelve summary + aspects_to_review. Sin métricas crudas.
//  - v3.4: se agrega un bloque OBSERVATIONS con frases determinísticas para
//    que el modelo las parafrasee.
//  - v3.5 (este archivo). Problemas observados en producción con 3.4:
//      1) Eco de las reglas: la REGLA 1 enumeraba literalmente los términos
//         prohibidos y decía "Una sesión aislada no evidencia una condición
//         clínica"; el 3B la reprodujo como contenido ("No se detectaron
//         patologías ni condiciones clínicas en esta sesión aislada").
//         → Las reglas se redactan en positivo y NO nombran términos
//           clínicos ni frases que el modelo pueda copiar.
//      2) Contradicción: OBSERVATIONS traía comparaciones pero la REGLA 3
//         prohibía mencionar otras sesiones; el modelo lo resolvía
//         escribiendo "mejora".
//         → Se elimina la prohibición: el modelo puede reformular las
//           comparaciones VÁLIDAS (las que observationsBuilder emitió) sin
//           cambiar su dirección, y repetir la aclaración de "no directamente
//           comparable" cuando los niveles de dificultad difieren.
//      3) aspects_to_review: en los 8 análisis persistidos concentraba la
//         mayoría de las afirmaciones especulativas (eficacia de la
//         actividad, capacidades, recomendaciones). No está anclado a ningún
//         dato.
//         → Ya no se pide. Los aspectos de seguimiento son los follow_up
//           determinísticos del backend. Si el modelo igual lo devuelve, el
//           validador lo descarta (ver responseValidator, aspectsPolicy).
//
// Qué recibe el modelo: nombres humanos de las actividades + HECHOS
// REGISTRADOS (las observaciones determinísticas). NO recibe cifras, estado
// de ánimo, nombre, edad, slugs, dominios, niveles de dificultad ni
// historial: esos datos los muestra el backend por otros canales.
//
// Qué devuelve: { "schema_version": "3", "summary": "..." }.
// El schema de salida sigue siendo "3" (compatible con el validador, la API
// y los análisis persistidos).
//
// Función pura: no llama Ollama, no lee env, no toca DB.

const PROMPT_VERSION = "3.5";
const OUTPUT_SCHEMA_VERSION = "3";

const ROLE = [
  "Redactás una síntesis breve para una psicóloga o un psicólogo que revisa una sesión de entrenamiento cognitivo realizada en MenteActiva.",
  "Tu única fuente de información son los HECHOS REGISTRADOS que figuran más abajo. Fueron calculados por el sistema a partir de las respuestas y son exactos.",
].join(" ");

const WRITING_GUIDE = [
  "Cómo escribir la síntesis:",
  "1. Reformulá los hechos registrados en una o dos oraciones claras, en español rioplatense, con tono profesional. Nombrá la actividad tal como figura, sin comillas.",
  "2. Usá solamente información que figure en los hechos registrados. Si algo no figura, no lo menciones.",
  "3. Conservá la dirección de cada hecho tal como está escrita (más correctas o más incorrectas; superior, inferior o similar; aumentó o disminuyó).",
  "4. Si un hecho dice que una comparación no es directamente comparable, decilo de esa forma y no describas la diferencia como subida ni bajada.",
  "5. Si un hecho dice que todavía no hay sesiones comparables, no hables de evolución ni de tendencia.",
  "6. Describí lo que se registró durante la sesión. Las conclusiones sobre la persona, sus capacidades, su salud, su estado o los pasos a seguir corresponden exclusivamente al profesional, no a esta síntesis.",
  "7. No escribas números ni porcentajes: el sistema muestra las cifras por separado.",
].join("\n");

const OUTPUT_INSTRUCTION = [
  "FORMATO DE RESPUESTA: devolvé únicamente un objeto JSON, sin texto antes ni después y sin bloque de código, con exactamente estos dos campos:",
  `{"schema_version": "${OUTPUT_SCHEMA_VERSION}", "summary": "<la síntesis>"}`,
].join("\n");

// Ejemplo de estilo con datos ficticios y una actividad inexistente, para
// que el modelo no lo confunda con la sesión real.
const STYLE_EXAMPLE = [
  "EJEMPLO DE ESTILO (datos ficticios, no corresponden a esta sesión):",
  "ACTIVIDAD: Actividad de ejemplo",
  "HECHOS REGISTRADOS:",
  "- La sesión fue completada en su totalidad.",
  "- Se registraron más respuestas incorrectas que correctas.",
  "- No existen todavía sesiones comparables para describir una tendencia.",
  "RESPUESTA:",
  `{"schema_version": "${OUTPUT_SCHEMA_VERSION}", "summary": "En la Actividad de ejemplo, la sesión se completó en su totalidad y se registraron más respuestas incorrectas que correctas. Todavía no hay sesiones comparables para describir una evolución."}`,
].join("\n");

/**
 * Construye el prompt que se envía a Ollama (v3.5).
 *
 * @param {object} context     Salida de buildSessionAnalysisContext.
 * @param {object} [extra]     { observations: string[] } — hechos
 *   determinísticos (observationsBuilder) que el modelo reformula.
 * @returns {{ prompt: string, promptVersion: string }}
 */
export function buildSessionAnalysisPrompt(context, extra = {}) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    throw new TypeError("context.sections vacío");
  }

  // Sin comillas: con format=json, si el modelo copia una comilla doble la
  // gramática de Ollama cierra el string y el summary queda truncado
  // (observado en la evaluación 3.5; ver contentSafety.findMalformedSummary).
  const activityNames = context.sections.map((s) => s.name).join(", ");
  const observations = Array.isArray(extra.observations) ? extra.observations : [];
  const factsBlock = observations.length > 0
    ? ["HECHOS REGISTRADOS:", ...observations.map((o) => `- ${o}`)]
    : ["HECHOS REGISTRADOS:", "- La sesión fue registrada."];

  const prompt = [
    ROLE,
    "",
    WRITING_GUIDE,
    "",
    STYLE_EXAMPLE,
    "",
    "SESIÓN A SINTETIZAR:",
    `ACTIVIDAD: ${activityNames}`,
    ...factsBlock,
    "",
    OUTPUT_INSTRUCTION,
  ].join("\n");

  return { prompt, promptVersion: PROMPT_VERSION };
}

export const PROMPT_BUILDER_VERSION = PROMPT_VERSION;
export const PROMPT_OUTPUT_SCHEMA_VERSION = OUTPUT_SCHEMA_VERSION;
