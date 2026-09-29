// 7E: Prompt Builder — v1.2.
//
// Cambios v1.2 (Etapa 7J.1A — calidad del contenido observada en analysis 230):
// - SYSTEM_RULES pasa a ser una lista NUMERADA de reglas cortas y explícitas
//   (los modelos 3B respetan mejor listas numeradas que un párrafo denso).
// - REGLA "lenguaje descriptivo": el summary y las observaciones deben
//   describir hechos y métricas, no interpretarlos.
// - REGLA "prohibición de interpretación normativa": vocabulario cerrado
//   ampliado con adjetivos/adverbios evaluativos y comparativos y sus
//   variantes morfológicas (buena, buen, alta, alto, ligeramente, moderado,
//   adecuado, prometedor, esperado, etc.). Sin excepciones salvo referencia
//   explícita en el contexto (hoy: ninguna).
// - REGLA "fuentes cerradas": el modelo solo puede nombrar section_slug y
//   dominios cognitivos que aparecen literalmente en el contexto. Prohibido
//   completar categorías con conocimiento general.
// - REGLA "summary factual": fórmulas descriptivas explícitas.
// - Semántica reforzada de aspects_to_review: métrica registrada + valor,
//   sin adjetivos. Schema v1 sin cambios.
// - Se agregan mini ejemplos POSITIVO / NEGATIVO como few-shot para reforzar
//   la aplicación de las reglas.
//
// Cambios v1.1 (Etapa 7I, opción A del diagnóstico ANALYSIS_EVIDENCE_INVALID):
// - Se rediseña la instrucción del campo `evidence` para eliminar el
//   condicional negativo ("NO incluir section_slug si scope=global") que
//   llama3.2:3b no respetaba de forma confiable.
// - En su lugar se declaran dos formas separadas y mutuamente excluyentes,
//   cada una con la lista EXACTA de claves permitidas y con un ejemplo
//   canónico.
// - Se remarca que mezclar ambas formas (por ejemplo agregar section_slug
//   a un objeto con scope="global") invalida TODA la respuesta.
// - El schema del validator NO cambia; solo cambia cómo se lo describe al
//   modelo. Ver responseValidator.js EVIDENCE_ALLOWED_FIELDS_*.
//
// Cambios v1.0 (7E):
// - PROMPT_BUILDER_VERSION = "1.0"
// - No incluye session.id (ajuste 7E §0).
// - Exige exactamente el schema v1 de salida definido en responseValidator.js.
// - Prohíbe explícitamente comparaciones normativas por edad.
// - Elimina cualquier ambigüedad del prompt anterior (sin "al menos estos campos";
//   ahora es "exactamente estos campos y nada más").
//
// Función pura: no llama Ollama, no lee env, no toca DB.

const PROMPT_VERSION = "1.2";

function fmtNumber(n) {
  if (n === null || n === undefined) return "null";
  if (Number.isInteger(n)) return String(n);
  return Number(n).toFixed(4).replace(/\.?0+$/, "");
}

function serializeMetrics(m) {
  return [
    `total_questions=${fmtNumber(m.total_questions)}`,
    `answered_questions=${fmtNumber(m.answered_questions)}`,
    `correct_count=${fmtNumber(m.correct_count)}`,
    `incorrect_count=${fmtNumber(m.incorrect_count)}`,
    `unanswered_count=${fmtNumber(m.unanswered_count)}`,
    `accuracy=${fmtNumber(m.accuracy)}`,
    `completion_rate=${fmtNumber(m.completion_rate)}`,
    `mean_latency_ms=${fmtNumber(m.mean_latency_ms)}`,
    `min_latency_ms=${fmtNumber(m.min_latency_ms)}`,
    `max_latency_ms=${fmtNumber(m.max_latency_ms)}`,
    `latency_std_ms=${fmtNumber(m.latency_std_ms)}`,
  ].join(", ");
}

const SYSTEM_RULES = [
  "Sos un asistente que ayuda a un profesional de salud mental a leer los resultados de una sesión de estimulación cognitiva en MenteActiva. Escribí siempre en español rioplatense, en tono adulto, respetuoso y no infantilizante.",
  "REGLA 1 — No diagnóstico: no diagnostiques. No menciones patologías, demencia, Alzheimer, deterioro cognitivo, MCI ni cualquier otro cuadro clínico.",
  "REGLA 2 — No tratamiento: no recomiendes tratamientos, medicación, derivaciones ni consultas específicas.",
  "REGLA 3 — No comparaciones normativas por edad: MenteActiva no expone edad y no dispone de normativas por edad. No infieras ni supongas rendimiento esperado por edad.",
  "REGLA 4 — No recalcular ni inventar umbrales: no recalcules las métricas y no inventes umbrales ni clasificaciones. Usá los números exactos entregados por MenteActiva; no sumes, no promediés, no redondees más allá de lo que ya viene.",
  "REGLA 5 — No inventar datos: no agregues nombre, edad, historia previa, comparaciones con otros pacientes, ni suposiciones sobre estado del paciente.",
  "REGLA 6 — LENGUAJE DESCRIPTIVO: describí hechos y métricas, no los interpretes. Fórmulas aceptables: 'Respondió correctamente 2 de 4 preguntas.', 'La precisión registrada fue del 50%.', 'La latencia media registrada fue de 3233 ms.'. No intercales interpretaciones sobre esos números.",
  "REGLA 7 — PROHIBICIÓN DE INTERPRETACIÓN NORMATIVA: sin una referencia explícita dentro del contexto, NO califiques ninguna métrica ni el desempeño. Prohibidos (y sus variantes morfológicas, adverbiales y sinónimos): alto, alta, altos, altas, elevado, elevada, bajo, baja, bajos, bajas, reducido, reducida, rápido, rápida, rápidos, rápidas, veloz, lento, lenta, lentos, lentas, bueno, buena, buenos, buenas, buen, malo, mala, malos, malas, mal, adecuado, adecuada, adecuados, adecuadas, inadecuado, inadecuada, correcto (como valoración de desempeño, no como conteo), normal, anormal, prometedor, prometedora, preocupante, mejor, peor, esperado, esperada, esperables, inesperado, inesperada, ligeramente, moderadamente, levemente, relativamente, sorprendente, óptimo, óptima, deficiente, adecuadamente, inadecuadamente. Tampoco 'buena capacidad', 'baja precisión', 'latencia elevada', 'respuesta rápida/lenta', 'bajo rendimiento' ni construcciones equivalentes.",
  "REGLA 8 — FUENTES CERRADAS: solo podés nombrar section_slug que aparezcan literalmente en el bloque SECTION del contexto, y solo podés nombrar dominios cognitivos que aparezcan literalmente en COGNITIVE_DOMAINS_TOUCHED. Prohibido completar categorías con conocimiento general del modelo. Por ejemplo, si COGNITIVE_DOMAINS_TOUCHED=[orientacion], no mencionar 'memoria', 'atención', 'funciones ejecutivas' ni ningún otro dominio, aunque parezcan relacionados.",
  "REGLA 9 — SUMMARY FACTUAL: el summary se limita a duración, cantidad de preguntas, correctas/incorrectas, accuracy, completion_rate, latencias y las secciones/dominios listados literalmente en el contexto. Sin inferencias sobre capacidad, estado ni desempeño.",
  "REGLA 10 — ASPECTS_TO_REVIEW SIN VALORACIÓN: cada string debe describir una métrica registrada del contexto y opcionalmente su valor. Aceptables: 'Precisión registrada: 50%', 'Latencia media registrada: 3233 ms'. NO aceptables: 'Baja precisión', 'Latencia elevada', 'Dificultades de orientación', 'Rendimiento a mejorar'.",
  "EJEMPLO POSITIVO (aprobado): summary='Sesión de 21 segundos con 4 preguntas de la sección orientacion_temporal. Respondió correctamente 2 de 4 (precisión 50%). Latencia media 3233 ms, mínima 2046 ms, máxima 5072 ms.'  observations_by_section[0].observation='Respondió las 4 preguntas de orientacion_temporal; 2 correctas y 2 incorrectas; latencia media 3233 ms.'  aspects_to_review=['Precisión registrada: 50%', 'Latencia media registrada: 3233 ms'].",
  "EJEMPLO NEGATIVO (rechazado y por qué): summary='Mostró buena capacidad en funciones ejecutivas, memoria y orientación temporal, con latencias ligeramente altas.' Rechazado por: (a) 'buena capacidad' (viola REGLA 7), (b) menciona 'funciones ejecutivas' y 'memoria' que no están en COGNITIVE_DOMAINS_TOUCHED (viola REGLA 8), (c) 'ligeramente altas' (viola REGLA 7).",
].join("\n");

const OUTPUT_INSTRUCTION = [
  "Devolvé EXCLUSIVAMENTE un objeto JSON UTF-8, sin markdown, sin texto antes ni después, sin comentarios.",
  "El objeto DEBE tener EXACTAMENTE estos campos (ni más ni menos):",
  "- \"schema_version\": string, valor exacto \"1\".",
  "- \"summary\": string en español, no vacío, máximo 400 caracteres.",
  "- \"observations_by_section\": arreglo con UNA entrada por cada section_slug listado en el contexto, en el MISMO orden en que aparecen abajo. Cada entrada es un objeto con EXACTAMENTE los campos { \"section_slug\": string, \"observation\": string ≤240 caracteres, no vacío }. Sin secciones adicionales ni duplicadas.",
  "- \"aspects_to_review\": arreglo de strings; puede ser []. Cada string es no vacío y ≤180 caracteres. El título humano de este bloque es 'Aspectos a revisar'.",
  "- \"evidence\": arreglo con AL MENOS 1 elemento y máximo 40, de referencias estructuradas verificables contra el contexto. Cada elemento DEBE tener una de estas DOS formas y NADA MÁS. Están completamente separadas: mezclar ambas (por ejemplo agregar section_slug a un objeto con scope=\"global\") invalida TODA la respuesta.",
  "Forma A — GLOBAL: el objeto contiene EXACTAMENTE tres claves: scope, metric, value. NUNCA incluir section_slug. Ejemplo válido: {\"scope\":\"global\",\"metric\":\"accuracy\",\"value\":0.5}.",
  "Forma B — SECTION: el objeto contiene EXACTAMENTE cuatro claves: scope, metric, value, section_slug. section_slug es OBLIGATORIO en esta forma y debe coincidir con un slug listado en el contexto. Ejemplo válido: {\"scope\":\"section\",\"metric\":\"accuracy\",\"value\":0.5,\"section_slug\":\"orientacion_temporal\"}.",
  "En ambas formas, metric debe ser uno de: total_questions, answered_questions, correct_count, incorrect_count, unanswered_count, accuracy, completion_rate, mean_latency_ms, min_latency_ms, max_latency_ms, latency_std_ms. value debe ser exactamente el número que aparece en el contexto para esa métrica/scope (o null si el contexto trae null); no lo redondees ni lo reinterpretes.",
  "NO agregues ningún otro campo (ni confidence, ni risk, ni diagnosis, ni severity, ni probability, ni score, ni recommendations, ni patterns).",
].join(" ");

/**
 * Construye el prompt que se envía a Ollama.
 *
 * @param {object} context   Salida de buildSessionAnalysisContext.
 * @returns {{ prompt: string, promptVersion: string }}
 */
export function buildSessionAnalysisPrompt(context) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  if (context.schema_version !== "1") {
    throw new TypeError(`schema_version no soportado: ${context.schema_version}`);
  }
  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    throw new TypeError("context.sections vacío");
  }

  const globalLine = `GLOBAL: ${serializeMetrics(context.global.metrics)}`;

  const sectionLines = context.sections.map((s) => {
    const domains = s.cognitive_domain_slugs.length
      ? s.cognitive_domain_slugs.join(",")
      : "sin_dominios_asociados";
    return `SECTION slug=${s.slug} name="${s.name}" cognitive_domains=[${domains}] metrics=(${serializeMetrics(s.metrics)})`;
  });

  const durationLine =
    context.duration_seconds !== null
      ? `duration_seconds=${fmtNumber(context.duration_seconds)}`
      : "duration_seconds=null";

  const domainsTouched = context.cognitive_domains_touched.length
    ? context.cognitive_domains_touched.join(",")
    : "ninguno";

  // Nota: no se emite patient_age en el prompt (7G §4).
  const prompt = [
    `SYSTEM: ${SYSTEM_RULES}`,
    "",
    `CONTEXT schema_version=${context.schema_version} language=${context.language} prompt_version=${PROMPT_VERSION}`,
    `SESSION ${durationLine}`,
    `COGNITIVE_DOMAINS_TOUCHED=[${domainsTouched}]`,
    globalLine,
    ...sectionLines,
    "",
    `OUTPUT: ${OUTPUT_INSTRUCTION}`,
  ].join("\n");

  return { prompt, promptVersion: PROMPT_VERSION };
}

export const PROMPT_BUILDER_VERSION = PROMPT_VERSION;
