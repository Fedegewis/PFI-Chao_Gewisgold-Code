// COPIA CONGELADA del prompt 3.4 (commit c7a0cb0). Sólo para la evaluación
// comparativa 3.4 vs 3.5 (scripts/eval/eval-prompts.js). No se usa en producción.

// 7E: Prompt Builder — v3.0.
//
// Rediseño total del prompt para estabilizar llama3.2:3b. Los datos
// estructurados (métricas, actividades, dominios, mood, comparación histórica)
// ya NO viajan al modelo: el backend los conoce y los expone directamente al
// profesional por otros canales (evidence, comparison_metrics, metadata de
// sesión). El modelo recibe un contexto mínimo factual y devuelve una síntesis
// descriptiva + aspectos a revisar.
//
// Cambios v3.0 (frente a v2.5):
//  - PROMPT_VERSION = "3.0" (break de contrato de salida).
//  - OUTPUT_SCHEMA_VERSION = "3".
//  - 5 reglas (vs 8). Lenguaje más corto y específico.
//  - Sin VALID_SECTION_SLUGS, sin PREVIOUS_SESSIONS, sin COMPARISON,
//    sin PATIENT_REPORTED_MOOD, sin cognitive_domain_slugs técnicos.
//  - SECTION pasa a mostrar únicamente el nombre humano de la actividad.
//  - GLOBAL metrics: se mantiene como ancla factual mínima.
//  - Output: sólo { schema_version, summary, aspects_to_review }.
//
// Función pura: no llama Ollama, no lee env, no toca DB.

// 3.4: incorpora un bloque OBSERVATIONS con las frases determinísticas
// generadas por observationsBuilder.js (basadas en datos reales del backend).
// El modelo recibe así un anclaje cualitativo concreto y se le pide
// parafrasear esas observaciones en 1-2 frases, sin inventar nuevas ni
// atribuir afirmaciones al profesional. Si Ollama falla, el backend ya
// tiene las observations persistidas en el análisis y las muestra tal cual.
// Schema de salida sigue siendo "3".
const PROMPT_VERSION = "3.4";
const OUTPUT_SCHEMA_VERSION = "3";

const SYSTEM_RULES = [
  "Sos un asistente que ayuda a un profesional de salud mental a leer resultados de una sesión de estimulación cognitiva en MenteActiva. Escribí en español rioplatense, adulto y respetuoso, sin infantilización.",
  "REGLA 1 — No diagnosticar. No afirmes patologías, cuadros ni condiciones clínicas. PROHIBIDOS: 'deterioro cognitivo', 'déficit', 'disfunción', 'trastorno', 'patología', 'dificultades cognitivas', 'capacidades cognitivas', 'alteración cognitiva', 'buena/mala memoria', 'buena/mala atención'. Una sesión aislada no evidencia una condición clínica.",
  "REGLA 2 — No calificar subjetivamente el desempeño. PROHIBIDOS: 'alto nivel de precisión', 'bajo nivel', 'excelente', 'pobre', 'destacado', 'insuficiente', 'adecuado', 'inadecuado'. Describí hechos observables, no juicios evaluativos.",
  "REGLA 3 — No inventar datos ni atribuir afirmaciones a terceros. PROHIBIDO frases tipo 'el profesional observó', 'el profesional afirmó', 'el paciente mostró una buena/mala X'. Vos no sos el profesional. No menciones nombre, edad, antecedentes, estado de ánimo, otras sesiones ni comparaciones históricas: si no aparece en el contexto, no existe para vos.",
  "REGLA 4 — No cifras numéricas en el texto. PROHIBIDOS porcentajes (ej '50%'), fracciones ('5/8'), 'N preguntas', 'N segundos', 'N aciertos'. El backend expone esos datos aparte en bloques separados. Describí la actividad en prosa.",
  "REGLA 5 — Formato JSON estricto: devolvé EXCLUSIVAMENTE un objeto JSON UTF-8, sin markdown, sin bloque de código, sin texto antes o después. El objeto DEBE tener EXACTAMENTE los campos descritos en OUTPUT.",
].join("\n");

const OUTPUT_INSTRUCTION = [
  "El objeto JSON tiene exactamente estos campos (nada más):",
  `- "schema_version": string, valor exacto "${OUTPUT_SCHEMA_VERSION}".`,
  "- \"summary\": string en español, UNA O DOS oraciones breves (idealmente 100-250 caracteres, máximo ABSOLUTO 1000). PARAFRASEÁ las frases listadas en OBSERVATIONS mencionando la actividad por su nombre. NO agregues observaciones nuevas, NO afirmes cosas que no estén en OBSERVATIONS, NO inventes cifras ni comparaciones, NO digas 'el profesional observó/afirmó'. Preferí frases cortas y directas.",
  "- \"aspects_to_review\": arreglo opcional de strings (puede ser [] o estar ausente), MÁXIMO 5 ítems. Cada string ≤180 caracteres, describe un punto puntual que el profesional podría revisar en la próxima sesión. Sin valoración clínica, sin cifras. Opcional: si no tenés nada que agregar, devolvé [].",
  "NO agregues ningún otro campo (ni observations_by_section, ni comparison, ni evidence, ni confidence, ni risk, ni diagnosis, ni severity, ni recommendations, ni cognitive_domains, ni section_slug). Las métricas, dominios, actividades, estado de ánimo y comparaciones las expone el backend aparte.",
].join(" ");

/**
 * Construye el prompt que se envía a Ollama.
 *
 * @param {object} context   Salida de buildSessionAnalysisContext.
 * @returns {{ prompt: string, promptVersion: string }}
 */
/**
 * Construye el prompt que se envía a Ollama (v3.4).
 *
 * @param {object} context     Salida de buildSessionAnalysisContext.
 * @param {object} [extra]     { observations: string[] } — frases
 *   determinísticas que el modelo debe parafrasear. Si no se pasan,
 *   el bloque OBSERVATIONS se omite del prompt.
 * @returns {{ prompt: string, promptVersion: string }}
 */
export function buildSessionAnalysisPrompt(context, extra = {}) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    throw new TypeError("context.sections vacío");
  }

  // Contexto mínimo (v3.4): nombres humanos de las actividades + un bloque
  // OBSERVATIONS con las frases determinísticas que el modelo debe parafrasear.
  // Las métricas, mood, historial detallado, slugs y dominios técnicos
  // siguen sin viajar al modelo.
  const sectionNames = context.sections.map((s) => `"${s.name}"`).join(", ");
  const sectionsCountLine = `SESSION activities=[${sectionNames}]`;

  const observations = Array.isArray(extra.observations) ? extra.observations : [];
  const observationsBlock = observations.length > 0
    ? ["OBSERVATIONS:", ...observations.map((o) => `- ${o}`)]
    : [];

  const prompt = [
    `SYSTEM: ${SYSTEM_RULES}`,
    "",
    `CONTEXT language=${context.language} prompt_version=${PROMPT_VERSION} output_schema=${OUTPUT_SCHEMA_VERSION}`,
    sectionsCountLine,
    ...observationsBlock,
    "",
    `OUTPUT: ${OUTPUT_INSTRUCTION}`,
  ].join("\n");

  return { prompt, promptVersion: PROMPT_VERSION };
}

export const PROMPT_BUILDER_VERSION = PROMPT_VERSION;
export const PROMPT_OUTPUT_SCHEMA_VERSION = OUTPUT_SCHEMA_VERSION;
