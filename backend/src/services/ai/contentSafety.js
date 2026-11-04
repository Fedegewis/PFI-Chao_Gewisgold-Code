// Seguridad del contenido generado por la IA (contrato v3, fase 1 de la
// auditoría 2026-11-04).
//
// Motivación: en producción el validador anterior aceptó "No se detectaron
// patologías ni condiciones clínicas en esta sesión aislada." porque el
// patrón /\bpatolog[ií]a\b/ sólo cubría el singular y porque `\b` en
// JavaScript sólo reconoce límites ASCII (falla con vocales acentuadas).
// Además, los 8 análisis persistidos contenían afirmaciones de eficacia
// terapéutica, atribución de capacidades y juicios evaluativos que ninguna
// lista cerrada contemplaba.
//
// Dos capas complementarias:
//
//  1) FAMILIAS DE AFIRMACIONES (no palabras sueltas): el texto se normaliza
//     (minúsculas, sin tildes, espacios colapsados) y se busca por raíces
//     (`patolog\w*` cubre singular, plural y derivados). Cada familia tiene
//     su propia `reason` para que el reintento y los logs sean legibles.
//
//  2) ANCLAJE (grounding): el `summary` debe parafrasear las OBSERVATIONS
//     determinísticas. Cada oración se compara contra el vocabulario
//     disponible (observaciones, seguimiento, nombres de actividades y un
//     vocabulario descriptivo base). Una oración con varias palabras de
//     contenido sin respaldo se rechaza como `ungrounded_statement`. Esta
//     capa detecta afirmaciones nuevas que ninguna lista anticipa.
//
// Funciones puras: sin DB, sin red, sin process.env.

// --------------------------------------------------------------------------
// Normalización
// --------------------------------------------------------------------------

export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Límites de palabra sobre texto normalizado (sólo a-z y dígitos tras quitar
// tildes; ñ queda como n). Se usan en lugar de \b para que el criterio sea
// explícito y no dependa de la definición ASCII de JavaScript.
const B = "(?<![a-z0-9])";
const E = "(?![a-z0-9])";

function re(body) {
  return new RegExp(`${B}(?:${body})${E}`);
}

const COGNITIVE_FUNCTIONS =
  "memoria|atencion|concentracion|orientacion|funciones? ejecutivas?|funcion cognitiva|" +
  "funciones cognitivas|calculo|razonamiento|lenguaje|comprension|aprendizaje|cognicion";

// --------------------------------------------------------------------------
// Familias. Cada entrada: { reason, label, patterns }.
// El orden importa sólo para elegir la primera reason informada.
// --------------------------------------------------------------------------

export const CLAIM_FAMILIES = Object.freeze([
  {
    reason: "clinical_rule_out",
    label: "Descarte o ausencia de condiciones clínicas",
    patterns: [
      re("descart\\w*"),
      re("sin (?:indicios|signos|senales|evidencias?|rastros) de"),
      re("no (?:hay|existen?|se (?:observan|observaron|encontraron|encuentran|aprecian)) (?:indicios|signos|senales|evidencias?) de"),
      re("no se (?:detect\\w*|diagnostic\\w*|identificaron (?:problemas|alteraciones|dificultades))"),
      re("ausencia de (?:indicios|signos|alteraciones?|problemas|dificultad\\w*|patolog\\w*|enfermedad\\w*)"),
      re("libre de \\w+"),
    ],
  },
  {
    reason: "forbidden_clinical_term",
    label: "Término clínico o diagnóstico",
    patterns: [
      re("patolog\\w*"),
      re("enfermedad\\w*|enferm[oa]s?"),
      re("demencia\\w*|alzheimer\\w*|parkinson\\w*"),
      re("deterioro\\w*"),
      re("trastorno\\w*"),
      re("sindrome\\w*"),
      re("diagnos\\w*|diagnostic\\w*"),
      re("deficit\\w*"),
      re("disfuncion\\w*"),
      re("alteracion(?:es)? (?:cognitiv\\w*|de la (?:" + COGNITIVE_FUNCTIONS + "))"),
      re("condicion(?:es)? (?:clinic\\w*|medic\\w*|neurologic\\w*|de salud)"),
      re("cuadros? (?:clinic\\w*|cognitiv\\w*)"),
      re("sintoma\\w*"),
      re("signos? (?:clinic\\w*|de alarma)"),
      re("(?:dificultades|capacidades) cognitivas"),
      re("san[oa]s?|saludables?"),
      re("anormal\\w*|normalidad|dentro de (?:lo|los|parametros|valores) normal\\w*|(?:valores|rango|parametros) normales"),
      re("neurodegenerativ\\w*|neurologic\\w*"),
      // Afirmaciones clínicas indirectas: describen un supuesto problema de
      // la persona sin nombrar una enfermedad.
      re("(?:problemas?|fallas?|fallos|trastornos?|alteraciones?|perdidas?|disminucion|declive|deficiencias?) (?:de|en) (?:la |el |su )?(?:" + COGNITIVE_FUNCTIONS + ")"),
      re("dificultad(?:es)? (?:para|al) (?:recordar|concentrar\\w*|orientar\\w*|comprender|atender|planificar|razonar|memorizar|retener)"),
      re("olvid\\w*|desorientad\\w*|desorientacion|confusion(?:es)?|confundid[oa]s?|lentitud (?:cognitiv\\w*|de procesamiento|mental)"),
      re("compatible(?:s)? con|sugestiv\\w*|indicativ[oa]s? de|signos? de alerta|factor(?:es)? de riesgo|riesgo\\w*"),
    ],
  },
  {
    reason: "clinical_recommendation",
    label: "Recomendación clínica o de intervención",
    patterns: [
      re("derivar\\w*|derivacion|interconsulta\\w*"),
      re("(?:consultar|consulte|acudir|recurrir) (?:a|con) (?:un |una |el |la )?(?:medic\\w*|neurolog\\w*|psiquiatr\\w*|especialista\\w*|profesional de la salud)"),
      re("evaluacion (?:neuropsicologica|clinica|medica|neurologica|diagnostica)"),
      re("(?:se recomienda|recomendamos|recomendable|es necesario|seria conveniente|conviene|deberia\\w*) (?:\\w+ ){0,3}(?:intervenir|tratar|derivar|evaluar|estudiar|controlar|aumentar|reducir|ajustar|modificar|cambiar|incrementar)"),
      // La dificultad la decide el mecanismo adaptativo del backend; el
      // modelo no debe proponer cambios de nivel ni de dificultad.
      re("(?:ajust|aument|reduc|disminu|baj|sub|cambi|modific|increment|adapt)\\w* (?:la |el |su )?(?:dificultad|nivel(?: de dificultad)?|exigencia|intensidad|carga)"),
    ],
  },
  {
    reason: "trend_claim",
    label: "Tendencia o evolución no respaldada",
    patterns: [
      re("tendencia (?:al alza|a la baja|ascendente|descendente|positiva|negativa|creciente|decreciente|favorable|desfavorable|de mejora|a mejorar|a empeorar)"),
      re("evolucion (?:positiva|negativa|favorable|desfavorable|ascendente|descendente)"),
      re("progresiv\\w*|de (?:forma|manera) (?:sostenida|progresiva|constante)|consistentemente|sistematicamente|cada vez (?:mas|menos|mejor|peor)"),
      // Una precisión inferior entre sesiones (con preguntas distintas y,
      // con el mecanismo adaptativo, posiblemente otro nivel) no es un
      // empeoramiento ni un declive: se describe como "inferior".
      re("empeor\\w*|declive|declin\\w*|retroce\\w*|involucion|desmejor\\w*"),
    ],
  },
  {
    reason: "mood_or_state_claim",
    label: "Estado de ánimo o estado de la persona (lo muestra el backend aparte)",
    patterns: [
      re("estado (?:de animo|emocional|animico)|(?:su |el )animo|emocion\\w*"),
      re("se (?:sintio|sentia|mostro|mostraba|encontraba) (?:\\w+ )?(?:bien|mal|tranquil\\w*|cansad\\w*|nervios\\w*|motivad\\w*|concentrad\\w*|ansios\\w*|triste\\w*|content\\w*|frustrad\\w*|comod\\w*|incomod\\w*)"),
      re("motivad[oa]s?|desmotivad\\w*|cansad[oa]s?|cansancio|fatiga\\w*|ansios[oa]s?|ansiedad|estres\\w*|nerviosismo|frustracion|frustrad[oa]s?|concentrad[oa]s?|distraid[oa]s?|tristeza|desgano"),
    ],
  },
  {
    reason: "therapeutic_or_improvement_claim",
    label: "Eficacia terapéutica o mejora cognitiva no demostrada",
    patterns: [
      re("(?:efectividad|eficacia|beneficios?|impacto|efecto) (?:terapeutic\\w*|de (?:la|el|las|los) (?:actividad\\w*|sesion\\w*|entrenamiento|estimulacion|ejercicios?|estrategia))"),
      re("(?:mejor\\w*|empeor\\w*|fortale\\w*|potenci\\w*|optimiz\\w*|recuper\\w*|rehabilit\\w*|preserv\\w*|retras\\w*|prevenir|previene|promover|promueve|favorec\\w*) (?:(?:de|en|a) )?(?:(?:la|el|las|los|su|sus) )?(?:" + COGNITIVE_FUNCTIONS + ")"),
      // Una diferencia entre sesiones con preguntas distintas no es una
      // "mejora": el backend la describe como superior/inferior.
      re("(?:mejora|mejoria|empeoramiento|progreso|avance|retroceso)s? (?:en|de) (?:la |el |los |las )?(?:precision|desempeno|rendimiento|tiempos?|resultados?|respuestas?)"),
      re("(?:mejor[oa]|mejoraron|empeor[oa]|empeoraron) (?:la |el |los |las )?(?:precision|desempeno|rendimiento|resultados?)"),
      re("gracias (?:al|a la|a los|a las) (?:entrenamiento|actividad\\w*|estimulacion|ejercicios?|sesion\\w*)"),
      re("terapi\\w*|terapeutic\\w*|tratamiento\\w*|rehabilitacion|farmac\\w*"),
      // "medicación" sola es legítima (actividad "Tomar la medicación");
      // se bloquea sólo como recomendación sanitaria.
      re("(?:ajust|revis|cambi|modific|suspend|indic|recomend|aument|reduc|disminu)\\w* (?:la |las |el |los |su |sus )?(?:medicacion|medicamentos?|dosis)"),
      re("(?:promover|promueve|favorecer|favorece) (?:el|la) (?:aprendizaje|plasticidad)"),
      re("plasticidad\\w*|reserva cognitiva"),
    ],
  },
  {
    reason: "capacity_attribution",
    label: "Atribución de capacidades o funciones cognitivas a la persona",
    patterns: [
      re("capacidad(?:es)? (?:del|de la|de los) (?:paciente|persona|usuari[oa])\\w*"),
      re("capacidad(?:es)? (?:cognitiv\\w*|para \\w+|de (?:procesar|recordar|atender|razonar|planificar|resolver))"),
      re("habilidad(?:es)? (?:cognitiv\\w*|del paciente|de la persona)"),
      re("(?:funcion|funcionamiento|rendimiento|desempeno|estado|perfil|nivel) cognitiv\\w*"),
      re("(?:" + COGNITIVE_FUNCTIONS + ") (?:del|de la) (?:paciente|persona|usuari[oa])"),
      re("(?:calidad|nivel) de (?:la )?(?:" + COGNITIVE_FUNCTIONS + ")"),
    ],
  },
  {
    reason: "evaluative_judgment",
    label: "Calificación subjetiva del desempeño",
    patterns: [
      re("con exito|exitos[oa]s?"),
      re("satisfactori\\w*|optim[oa]s?|excelente\\w*|sobresalient\\w*|destacad[oa]s?|deficiente\\w*|pobre\\w*|preocupant\\w*|alarmant\\w*|insuficiente\\w*"),
      re("(?:resultados?|desempenos?|rendimientos?) (?:positiv\\w*|negativ\\w*|favorabl\\w*|desfavorabl\\w*|buen[oa]s?|mal[oa]s?)"),
      re("(?:buen[oa]?s?|mal[oa]?s?|alto|baja?o?) (?:desempeno|rendimiento|nivel)"),
      re("(?:alto|bajo|muy alto|muy bajo) nivel de (?:precision|desempeno|rendimiento|acierto|exactitud)"),
      re("nivel (?:alto|bajo|adecuado|inadecuado)"),
      re("muy (?:bien|mal)|de manera (?:adecuada|inadecuada)"),
      re("(?:buena|mala|buenas|malas|excelentes?|pobres?) (?:" + COGNITIVE_FUNCTIONS + ")"),
      re("(?:" + COGNITIVE_FUNCTIONS + ") (?:deficientes?|disminuid[oa]s?|afectad[oa]s?|conservad[oa]s?|preservad[oa]s?|intact[oa]s?)"),
      re("equilibrio saludable|abrumador\\w*"),
    ],
  },
  {
    reason: "speculative_interpretation",
    label: "Interpretación o causalidad no respaldada por los datos",
    patterns: [
      re("factores? (?:externos?|emocionales|ajenos)"),
      re("podria (?:deberse|indicar|reflejar|sugerir|estar relacionad\\w*)|se deba a|debid[oa] a (?:factores|causas|problemas)"),
      re("(?:lo que |esto |ello )?(?:sugiere|sugieren|indica|indican|refleja|reflejan|evidencia|evidencian|demuestra|demuestran) (?:que|una|un)"),
      re("afectando negativamente|afecta negativamente|impacto negativo"),
    ],
  },
  {
    reason: "prompt_rule_echo",
    label: "Repetición de las instrucciones del asistente",
    patterns: [
      re("juicios? evaluativ\\w*|valoraciones? evaluativ\\w*"),
      re("de manera objetiva"),
      re("sin (?:juicios|valoraciones|diagnosticos?|comparaciones|cifras)"),
      re("sesion aislada"),
      re("(?:soy|como) (?:un )?asistente"),
      re("observations|regla \\d"),
    ],
  },
  {
    reason: "unauthorized_observation_about_actor",
    label: "Afirmación atribuida al profesional o calificación de la persona",
    patterns: [
      re("(?:el|la) profesional (?:observ|afirm|conclu|destac|not|detect|evalu|interpret|identific)\\w*"),
      re("segun (?:el|la) profesional"),
      re("el paciente (?:mostro|demostro|evidencio|exhibio) (?:una |un )?(?:buen|mal|excelente|pobre|alt|baj|destacad)\\w*"),
    ],
  },
]);

/**
 * Busca la primera familia de afirmaciones no permitidas en el texto.
 * @param {string} text
 * @returns {null | {reason: string, label: string, match: string}}
 */
export function findForbiddenClaim(text) {
  const norm = normalizeText(text);
  if (!norm) return null;
  for (const family of CLAIM_FAMILIES) {
    for (const pattern of family.patterns) {
      const m = pattern.exec(norm);
      if (m) return { reason: family.reason, label: family.label, match: m[0] };
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Anclaje (grounding)
// --------------------------------------------------------------------------

// Palabras funcionales de 4+ letras (normalizadas) que no aportan contenido.
const STOPWORDS = new Set(
  (
    "para como pero este esta esto estos estas sobre entre desde hasta cuando donde porque tambien " +
    "todo toda todos todas cada otro otra otros otras sido fueron sean siendo esten estan estaba " +
    "unos unas mismo misma mismos mismas solo sola solamente ademas segun tanto tiene tienen tuvo hubo " +
    "habia haber puede pueden pudo hace hacia dicha dicho cual cuales mucho mucha muchas muchos poco " +
    "poca pocos pocas menos algo alguna algunas algunos alguno nada ninguna ninguno aqui alli asi ello " +
    "ellos ellas ella quien quienes dentro fuera luego ahora antes despues siempre nunca mediante " +
    "aunque embargo mientras durante cuyo cuya respecto acerca traves medio lado parte vez veces " +
    "sino tras ante bajo contra hacia segun entonces donde cuanto cuanta"
  ).split(" ")
);

// Vocabulario descriptivo neutro que el resumen puede usar aunque no figure
// literalmente en las observaciones (sustantivos del dominio, conectores
// descriptivos, verbos de registro). No incluye ningún término evaluativo,
// clínico ni causal.
const BASE_VOCABULARY = (
  "sesion sesiones estimulacion cognitiva entrenamiento actividad actividades menteactiva " +
  "registro registraron registrandose registrando registrada registradas registrado " +
  "respuesta respuestas pregunta preguntas correcta correctas incorrecta incorrectas acierto aciertos " +
  "completo completa completada completado completaron totalidad realizo realizada realizado realizaron " +
  "mayor menor numero cantidad proporcion mayoria minoria resto mitad igual similar similares " +
  "existe existen todavia tendencia comparable comparables describir describe observar " +
  "presento presentaron incluyo incluyeron trabajo trabajada consistio corresponde " +
  "primera segunda unica previa previas anterior anteriores actual nueva nuevas " +
  // Sinónimos neutros frecuentes en paráfrasis legítimas. Los hechos que
  // expresan (completitud, aciertos, comparaciones) se verifican aparte con
  // findFactContradiction, así que admitirlos aquí no habilita afirmaciones
  // falsas.
  "finalizo finalizada finalizado termino terminada terminado respondio respondieron respondidas " +
  "contesto contestaron contestadas acerto acertadas error errores ejercicio ejercicios tarea tareas " +
  "consigna consignas item items bloque distribucion evolucion comparacion respecto diferencia " +
  "dificultad nivel precision tiempo promedio ritmo directamente distinto distinta resultado resultados " +
  "registros datos dato sistema"
).split(" ");

const STEM_LENGTH = 5;
const MIN_TOKEN_LENGTH = 4;

function stem(token) {
  return token.length > STEM_LENGTH ? token.slice(0, STEM_LENGTH) : token;
}

function contentTokens(text) {
  const norm = normalizeText(text);
  const words = norm.match(/[a-z]+/g) || [];
  return words.filter((w) => w.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(w));
}

export function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const GROUNDING_LIMITS = Object.freeze({
  // Una oración se rechaza si tiene al menos `minUnsupported` palabras de
  // contenido sin respaldo Y esas palabras superan `maxUnsupportedRatio`.
  minUnsupported: 3,
  maxUnsupportedRatio: 0.4,
});

/**
 * Construye el conjunto de raíces respaldadas por los datos de la sesión.
 * @param {{observations?: string[], followUp?: string[], activityNames?: string[]}} sources
 */
export function buildSupportedStems({ observations = [], followUp = [], activityNames = [] } = {}) {
  const stems = new Set(BASE_VOCABULARY.map(stem));
  for (const text of [...observations, ...followUp, ...activityNames]) {
    for (const t of contentTokens(String(text).replace(/_/g, " "))) stems.add(stem(t));
  }
  return stems;
}

/**
 * Busca la primera oración sin respaldo en los datos de la sesión.
 * @returns {null | {sentence: string, unsupported: string[]}}
 */
export function findUngroundedSentence(text, supportedStems, limits = GROUNDING_LIMITS) {
  for (const sentence of splitSentences(text)) {
    const tokens = contentTokens(sentence);
    if (tokens.length === 0) continue;
    const unsupported = tokens.filter((t) => !supportedStems.has(stem(t)));
    if (
      unsupported.length >= limits.minUnsupported &&
      unsupported.length / tokens.length > limits.maxUnsupportedRatio
    ) {
      return { sentence, unsupported };
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Consistencia con los datos registrados
// --------------------------------------------------------------------------
//
// El anclaje léxico no alcanza: "Se registraron más respuestas incorrectas
// que correctas" comparte todas sus palabras con la observación opuesta. Por
// eso los hechos cerrados que el backend conoce (completitud, distribución
// de respuestas, dirección y validez de la comparación) se verifican de forma
// estructurada: cada oración que afirme uno de esos hechos debe coincidir con
// el dato real. Si el texto afirma un hecho que no se puede verificar (por
// ejemplo, una comparación cuando no hay sesión comparable), se rechaza.

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Hechos verificables a partir del contexto de análisis (contextBuilder).
 * @returns {{ completion: "complete"|"incomplete"|null,
 *             distribution: "more_correct"|"more_incorrect"|"equal"|null,
 *             allCorrect: boolean, noneCorrect: boolean,
 *             comparison: null | { comparable: boolean|null,
 *               accuracy: string|null, latency: string|null } }}
 */
export function buildFactSheet(context) {
  const m = context?.global?.metrics || {};
  return factSheetFrom({
    total: num(m.total_questions),
    correct: num(m.correct_count),
    incorrect: num(m.incorrect_count),
    completion: num(m.completion_rate),
    comparison: context?.comparison_metrics || null,
  });
}

/**
 * Mismos hechos, reconstruidos desde un análisis persistido (evidence +
 * comparison_metrics), para revisar análisis históricos.
 */
export function factSheetFromStoredAnalysis(content) {
  const evidence = Array.isArray(content?.evidence) ? content.evidence : [];
  const g = (metric) => {
    const e = evidence.find((x) => x && x.scope === "global" && x.metric === metric);
    return e ? num(e.value) : null;
  };
  return factSheetFrom({
    total: g("total_questions"),
    correct: g("correct_answers"),
    incorrect: g("incorrect_answers"),
    completion: g("completion_rate"),
    comparison: content?.comparison_metrics || null,
  });
}

function factSheetFrom({ total, correct, incorrect, completion, comparison }) {
  let distribution = null;
  if (correct !== null && incorrect !== null && (correct > 0 || incorrect > 0)) {
    distribution = correct > incorrect ? "more_correct" : correct < incorrect ? "more_incorrect" : "equal";
  }
  let cmp = null;
  if (comparison && typeof comparison === "object") {
    const level = comparison.difficulty_level;
    const comparable = level ? (level.same === true ? true : level.same === false ? false : null) : true;
    const dir = (d) => (d === "subió" ? "up" : d === "bajó" ? "down" : d === "igual" ? "same" : null);
    cmp = {
      comparable,
      accuracy: dir(comparison.accuracy?.direction),
      latency: dir(comparison.mean_latency_ms?.direction),
    };
  }
  return {
    completion: completion === null ? null : completion >= 1 - 1e-9 ? "complete" : "incomplete",
    distribution,
    allCorrect: total !== null && correct !== null && total > 0 && correct === total,
    noIncorrect: incorrect === 0 && correct !== null && correct > 0,
    noneCorrect: correct === 0 && incorrect !== null && incorrect > 0,
    comparison: cmp,
  };
}

const R = re;
const CLAIMS = {
  moreCorrect: R("mas (?:respuestas )?correctas que (?:respuestas )?incorrectas|mayor (?:cantidad|numero|proporcion) de (?:respuestas )?correctas|mayoria de (?:las )?respuestas (?:fueron )?correctas|predominaron (?:las )?(?:respuestas )?correctas|menos (?:respuestas )?incorrectas que (?:respuestas )?correctas"),
  moreIncorrect: R("mas (?:respuestas )?incorrectas que (?:respuestas )?correctas|mayor (?:cantidad|numero|proporcion) de (?:respuestas )?incorrectas|mayoria de (?:las )?respuestas (?:fueron )?incorrectas|predominaron (?:las )?(?:respuestas )?incorrectas|menos (?:respuestas )?correctas que (?:respuestas )?incorrectas"),
  equal: R("(?:similar|igual|misma|pareja|equivalente) (?:cantidad|numero|proporcion) de (?:respuestas )?correctas e incorrectas|cantidad de (?:respuestas )?correctas e incorrectas fue (?:similar|igual|pareja|equivalente)"),
  allCorrect: R("todas las (?:respuestas|preguntas) (?:fueron )?(?:respondidas )?correct\\w*|(?:respondio|acerto) todas"),
  noIncorrect: R("sin (?:errores|respuestas incorrectas)|ningun error|ninguna (?:respuesta )?(?:fue )?incorrecta|no (?:se )?(?:registraron|hubo) (?:respuestas )?(?:incorrectas|errores)"),
  noneCorrect: R("ninguna (?:respuesta )?(?:fue )?correcta|todas las respuestas (?:fueron )?incorrectas"),
  complete: R("(?:complet\\w*|respondid\\w*|finaliz\\w*|realizad\\w*) (?:en su totalidad|totalmente|por completo|integramente)|(?:se respondieron|fueron respondidas) todas|todas las preguntas (?:fueron )?respondidas"),
  incomplete: R("(?:preguntas?|respuestas?) sin (?:responder|respuesta|contestar)|quedaron sin (?:responder|contestar)|no (?:se )?(?:fue )?complet\\w*|no se respondieron todas|incomplet\\w*|parcialmente"),
  accUp: R("precision (?:fue |resulto )?(?:superior|mayor|mas alta)|(?:mayor|superior) precision|precision (?:aumento|subio|crecio)|(?:aumento|subio|crecio) la precision"),
  accDown: R("precision (?:fue |resulto )?(?:inferior|menor|mas baja)|(?:menor|inferior) precision|precision (?:disminuyo|bajo|descendio|cayo)|(?:disminuyo|bajo|descendio|cayo) la precision"),
  accSame: R("precision (?:fue |resulto )?(?:similar|igual|equivalente|pareja)|(?:similar|igual|misma) precision"),
  latUp: R("tiempo (?:promedio )?(?:de respuesta )?(?:fue )?(?:mayor|mas largo|mas extenso|aumento|subio|crecio)|(?:aumento|subio|crecio) el tiempo|respuestas? mas lentas?|mas lentitud|(?:mayor|mas) tiempo (?:promedio )?(?:de respuesta|para responder)"),
  latDown: R("tiempo (?:promedio )?(?:de respuesta )?(?:fue )?(?:menor|mas corto|mas breve|disminuyo|bajo|se redujo)|(?:disminuyo|bajo|se redujo) el tiempo|respuestas? mas rapidas?|mas rapid\\w*|(?:menor|menos) tiempo (?:promedio )?(?:de respuesta|para responder)"),
  notComparable: R("no (?:es |son |resulta |resultan )?(?:directamente )?comparables?|nivel(?:es)? de dificultad (?:distint|diferent)\\w*|dificultad (?:distint|diferent)\\w*"),
  noComparable: R("no (?:existen|hay|se registran|se cuenta con)(?: todavia| aun)? (?:otras )?sesiones (?:previas )?comparables|todavia no hay sesiones|aun no hay sesiones|sin sesiones (?:previas )?comparables"),
  mentionsPrevious: R("sesion(?:es)? (?:anterior|anteriores|previa|previas|pasada|pasadas)|(?:en )?comparacion con (?:la|una|otra|las|otras) sesion\\w*|respecto (?:de|a) (?:la|una|otra) sesion\\w*|comparad[oa]s? con (?:la|una|otra) sesion\\w*|que la vez anterior|que antes"),
};

/**
 * Busca la primera afirmación que contradiga los hechos registrados.
 * @returns {null | {sentence: string, claim: string}}
 */
export function findFactContradiction(text, facts) {
  if (!facts) return null;
  for (const sentence of splitSentences(text)) {
    const s = normalizeText(sentence);
    const fail = (claim) => ({ sentence, claim });
    const has = (k) => CLAIMS[k].test(s);

    if (has("moreCorrect") && facts.distribution !== "more_correct") return fail("distribution_more_correct");
    if (has("moreIncorrect") && facts.distribution !== "more_incorrect") return fail("distribution_more_incorrect");
    if (has("equal") && facts.distribution !== "equal") return fail("distribution_equal");
    if (has("allCorrect") && !facts.allCorrect) return fail("all_correct");
    if (has("noIncorrect") && !facts.noIncorrect) return fail("no_incorrect");
    if (has("noneCorrect") && !facts.noneCorrect) return fail("none_correct");
    if (has("incomplete") && facts.completion !== "incomplete") return fail("completion_incomplete");
    if (!has("incomplete") && has("complete") && facts.completion !== "complete") return fail("completion_complete");

    const accClaim = has("accUp") ? "up" : has("accDown") ? "down" : has("accSame") ? "same" : null;
    const latClaim = has("latUp") ? "up" : has("latDown") ? "down" : null;
    const negatesComparison = has("noComparable");
    const cmp = facts.comparison;

    if (negatesComparison && cmp) return fail("denies_existing_comparison");
    if (!cmp) {
      // Sin sesión comparable: cualquier afirmación comparativa es inventada.
      if (!negatesComparison && (accClaim || latClaim || has("mentionsPrevious"))) return fail("comparison_without_reference");
      continue;
    }
    if (accClaim) {
      // Niveles distintos o desconocidos: la precisión no se describe como
      // subida/bajada (P1 del mecanismo adaptativo).
      if (cmp.comparable !== true) return fail("accuracy_direction_not_comparable");
      if (cmp.comparable === true && accClaim !== cmp.accuracy) return fail("accuracy_direction");
    }
    if (latClaim && latClaim !== cmp.latency) return fail("latency_direction");
    if (has("notComparable") && cmp.comparable === true) return fail("claims_not_comparable");
  }
  return null;
}

// --------------------------------------------------------------------------
// Revisión de análisis persistidos (protección al leer)
// --------------------------------------------------------------------------

// Campos redactados por el modelo según la versión del contrato. Todo lo
// demás (activities, evidence, comparison_metrics, observations, follow_up)
// es determinístico del backend y se conserva siempre.
const MODEL_FIELDS_V3 = ["summary", "aspects_to_review"];
const MODEL_FIELDS_LEGACY = ["summary", "aspects_to_review", "observations_by_section", "comparison"];

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/**
 * Evalúa con las reglas vigentes el texto redactado por el modelo en un
 * análisis ya persistido. No modifica nada.
 *
 * @param {object} content  session_analyses.analysis
 * @returns {{compliant: boolean, reasons: string[]}}
 */
export function reviewStoredAnalysis(content) {
  if (!content || typeof content !== "object") return { compliant: true, reasons: [] };
  const isV3 = content.schema_version === "3";
  const fields = isV3 ? MODEL_FIELDS_V3 : MODEL_FIELDS_LEGACY;
  const reasons = new Set();

  for (const field of fields) {
    for (const text of collectStrings(content[field])) {
      const hit = findForbiddenClaim(text);
      if (hit) reasons.add(hit.reason);
    }
  }

  if (isV3 && findMalformedSummary(content.summary)) reasons.add("malformed_summary");

  // El anclaje sólo aplica a v3 con observaciones persistidas (v3.4+), que
  // es el contrato en el que el summary debe parafrasearlas.
  if (isV3 && typeof content.summary === "string" && Array.isArray(content.observations) && content.observations.length > 0) {
    const stems = buildSupportedStems({
      observations: content.observations,
      followUp: Array.isArray(content.follow_up) ? content.follow_up : [],
      activityNames: (Array.isArray(content.activities) ? content.activities : [])
        .flatMap((a) => [a?.name, a?.slug])
        .filter((s) => typeof s === "string"),
    });
    if (findUngroundedSentence(content.summary, stems)) reasons.add("ungrounded_statement");
  }

  // Consistencia con los datos persistidos junto al análisis (evidence y
  // comparison_metrics). Sin evidence no hay hechos contra los cuales
  // verificar, y la verificación se omite.
  if (isV3 && typeof content.summary === "string" && Array.isArray(content.evidence) && content.evidence.length > 0) {
    if (findFactContradiction(content.summary, factSheetFromStoredAnalysis(content))) {
      reasons.add("contradicts_recorded_data");
    }
  }

  return { compliant: reasons.size === 0, reasons: [...reasons] };
}

/**
 * Devuelve una copia del contenido sin los campos redactados por el modelo
 * cuando no cumplen las reglas vigentes. El registro en DB no se toca.
 */
export function withholdNonCompliantText(content) {
  const review = reviewStoredAnalysis(content);
  if (review.compliant) return { content, withheld: false, reasons: [] };
  const fields = content.schema_version === "3" ? MODEL_FIELDS_V3 : MODEL_FIELDS_LEGACY;
  const copy = { ...content };
  for (const f of fields) delete copy[f];
  return { content: copy, withheld: true, reasons: review.reasons };
}

// ---------------------------------------------------------------------------
// Forma del summary (evaluación 3.5, 2026-11-04).
//
// Observado con llama3.2:3b + format=json: cuando el modelo intenta escribir
// el nombre de la actividad entre comillas dobles, la gramática JSON de
// Ollama cierra el string en esa comilla y el summary queda truncado
// ("La sesión de entrenamiento cognitivo "). Es JSON válido y no contiene
// afirmaciones prohibidas, pero no es una síntesis. También se observaron
// entidades HTML (&quot;) en lugar de comillas.
// ---------------------------------------------------------------------------

const MIN_SUMMARY_WORDS = 6;

/**
 * Devuelve un motivo si el summary está truncado o mal formado; null si no.
 */
export function findMalformedSummary(summary) {
  if (typeof summary !== "string") return null;
  const t = summary.trim();
  if (/&(?:[a-z]+|#\d+);/i.test(t)) return "html_entity";
  if (!/[.!?…]["'»)]?$/.test(t)) return "missing_final_punctuation";
  if (t.split(/\s+/).filter(Boolean).length < MIN_SUMMARY_WORDS) return "too_short";
  return null;
}

// Reasons semánticas ante las que se reintenta una vez la generación: son
// modos conocidos de inestabilidad del modelo, no fallas de contrato.
export const RETRIABLE_SEMANTIC_REASONS = Object.freeze(new Set([
  "malformed_summary",
  "max_length_exceeded",
  "numeric_metric_in_text",
  "ungrounded_statement",
  "contradicts_recorded_data",
  ...CLAIM_FAMILIES.map((f) => f.reason),
]));

// Opciones de validación que usan AMBAS rutas de generación (in-process y
// worker). Mantenerlas en un solo lugar garantiza que un mismo texto del
// modelo reciba exactamente la misma decisión por cualquiera de las dos.
export const GENERATION_VALIDATION_OPTIONS = Object.freeze({
  checkFacts: true,
  checkForm: true,
  aspectsPolicy: "discard",
});

/**
 * Mensaje interno para session_analyses.error_message: antepone la reason
 * semántica para que el motivo de rechazo quede registrado y sea
 * consultable. Nunca se expone por la API.
 */
export function formatValidationFailure(err) {
  const reason = err?.info?.reason;
  const message = String(err?.message ?? "");
  return reason ? `[${reason}] ${message}` : message;
}
