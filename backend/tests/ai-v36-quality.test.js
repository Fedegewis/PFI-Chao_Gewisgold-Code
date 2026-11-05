// Contrato IA 3.6: hechos enriquecidos (sessionFacts), estado de ánimo como
// autorreporte, verificación de hechos por tipo de pregunta / presentación /
// tiempos, aspectos sugeridos filtrados y revisión al leer.
//
// Funciones puras: sin DB, sin Ollama.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSessionFacts, normalizeQuestionDetails } from "../src/services/ai/sessionFacts.js";
import { buildAnalysisMaterials } from "../src/services/ai/analysisMaterials.js";
import {
  findForbiddenClaim,
  findFactContradiction,
  buildFactSheet,
  filterAspects,
  withholdNonCompliantText,
  reviewStoredAnalysis,
  AI_CONTRACT_V36,
} from "../src/services/ai/contentSafety.js";
import { parseAndValidateSessionAnalysis } from "../src/services/ai/responseValidator.js";
import { AnalysisValidationCodes as CODES } from "../src/services/ai/validationErrors.js";

function q(subdimension, has_stimulus, result, ms = 2500) {
  return {
    section_slug: "atencion_visual",
    subdimension,
    has_stimulus,
    answered: result !== "u",
    is_correct: result === "c" ? true : result === "i" ? false : null,
    response_time_ms: result === "u" ? null : ms,
  };
}

function metricsFrom(details) {
  const answered = details.filter((d) => d.answered);
  const correct = answered.filter((d) => d.is_correct).length;
  return {
    total_questions: details.length,
    answered_questions: answered.length,
    correct_count: correct,
    incorrect_count: answered.length - correct,
    unanswered_count: details.length - answered.length,
    accuracy: answered.length ? correct / answered.length : null,
    completion_rate: answered.length / details.length,
    mean_latency_ms: 3000, min_latency_ms: 2000, max_latency_ms: 4500, latency_std_ms: 500,
  };
}

const DETAILS = [
  q("memoria_de_ubicacion", true, "i", 4500),
  q("memoria_de_ubicacion", true, "i", 4300),
  q("asociacion_objeto_lugar", false, "c", 2300),
  q("categorizacion_funcional", false, "c", 2100),
];

function makeContext({ mood = "cansancio", details = DETAILS, comparison = null } = {}) {
  const m = metricsFrom(details);
  return {
    schema_version: "2",
    language: "es",
    duration_seconds: 200,
    ...(mood ? { patient_reported_mood: mood } : {}),
    global: { metrics: m },
    sections: [{ slug: "atencion_visual", name: "Objetos de la casa", cognitive_domain_slugs: ["atencion"], metrics: m }],
    cognitive_domains_touched: ["atencion"],
    ...(comparison ? { comparison_metrics: comparison } : {}),
  };
}

function materials(opts = {}) {
  const context = makeContext(opts);
  const input = {
    question_details: opts.details || DETAILS,
    adaptive_level: opts.level === undefined ? 2 : opts.level,
    same_activity_previous_count: opts.previous ?? 0,
  };
  return { context, ...buildAnalysisMaterials(context, input) };
}

// --------------------------------------------------------------------------

describe("sessionFacts — hechos en palabras, sin cifras", () => {
  it("describe tipos de pregunta, presentación, tiempos, nivel y ánimo", () => {
    const { blocks, sentences, sheet } = buildSessionFacts(makeContext(), {
      questionDetails: DETAILS, adaptiveLevel: 3, sameActivityPreviousCount: 1,
    });
    assert.equal(blocks.level, "más exigente");
    assert.equal(blocks.mood, "cansancio");
    assert.ok(blocks.types.includes("En las preguntas de recuerdo de la ubicación de objetos, que presentaban información previa que luego se ocultaba, todas las respuestas fueron incorrectas."));
    assert.ok(blocks.types.includes("La única pregunta de asociación entre objetos y lugares, con la información a la vista, fue respondida correctamente."));
    assert.ok(blocks.types.some((t) => t.includes("la proporción de respuestas correctas fue menor")));
    assert.ok(blocks.times.includes("Las respuestas incorrectas llevaron en promedio más tiempo que las correctas."));
    assert.ok(blocks.times.some((t) => t.includes("mayor tiempo de respuesta de la sesión se registró en una pregunta de recuerdo de la ubicación de objetos")));
    assert.deepEqual(blocks.history, ["Hay una sesión anterior registrada de esta misma actividad."]);
    for (const s of sentences) assert.ok(!/\d/.test(s), `sin dígitos: ${s}`);
    assert.equal(sheet.stimulus_comparison, "stimulus_less_correct");
    assert.equal(sheet.latency_correct_vs_incorrect, "incorrect_slower");
    assert.equal(sheet.slowest_type, "memoria_de_ubicacion");
    assert.equal(sheet.mood, "cansancio");
    assert.equal(sheet.level, 3);
  });

  it("ignora subdimensiones desconocidas o nulas y no inventa tipos", () => {
    const { blocks, sheet } = buildSessionFacts(makeContext(), {
      questionDetails: [q(null, false, "c"), q("inventada_x", false, "i")],
    });
    assert.deepEqual(blocks.types, []);
    assert.deepEqual(sheet.types, []);
    assert.equal(blocks.level, null);
  });

  it("tiempos similares por debajo de la cota de ruido", () => {
    const { sheet } = buildSessionFacts(makeContext(), {
      questionDetails: [q("calculo_funcional", false, "c", 3000), q("calculo_funcional", false, "i", 3100)],
    });
    assert.equal(sheet.latency_correct_vs_incorrect, "similar");
  });

  it("normalizeQuestionDetails descarta latencias de preguntas sin responder", () => {
    const [d] = normalizeQuestionDetails([{ subdimension: "calculo_funcional", answered: false, is_correct: true, response_time_ms: 900 }]);
    assert.equal(d.is_correct, null);
    assert.equal(d.response_time_ms, null);
  });
});

describe("estado de ánimo informado (3.6)", () => {
  it("permite mencionarlo como autorreporte del valor registrado", () => {
    assert.equal(findForbiddenClaim("Al comenzar, la persona informó sentir cansancio.", { reportedMood: "cansancio" }), null);
    assert.equal(findForbiddenClaim("Indicó que se sentía cansada al iniciar.", { reportedMood: "cansancio" }), null);
  });

  it("rechaza vincularlo con los resultados", () => {
    const hit = findForbiddenClaim("Informó cansancio, lo que podría explicar las respuestas incorrectas.", { reportedMood: "cansancio" });
    assert.equal(hit?.reason, "mood_or_state_claim");
    assert.equal(findForbiddenClaim("A pesar del cansancio informado, completó la sesión.", { reportedMood: "cansancio" })?.reason, "mood_or_state_claim");
  });

  it("rechaza un estado distinto del registrado o sin verbo de reporte", () => {
    assert.equal(findForbiddenClaim("La persona informó sentir tristeza.", { reportedMood: "cansancio" })?.reason, "mood_or_state_claim");
    assert.equal(findForbiddenClaim("La persona estaba cansada.", { reportedMood: "cansancio" })?.reason, "mood_or_state_claim");
  });

  it("sin estado registrado se mantiene el rechazo de 3.5", () => {
    assert.equal(findForbiddenClaim("Informó sentir cansancio.")?.reason, "mood_or_state_claim");
    const facts = buildFactSheet(makeContext({ mood: null }), { mood: null, types: [] });
    assert.equal(findFactContradiction("Al comenzar informó sentir calma.", facts)?.claim, "mood_without_record");
  });
});

describe("verificación de hechos enriquecidos (3.6)", () => {
  const { context, facts } = materials();
  const sheet = buildFactSheet(context, facts.sheet);

  it("acepta las descripciones correctas", () => {
    for (const s of [
      "En las preguntas de recuerdo de la ubicación de objetos, con información previa que luego se oculta, todas las respuestas fueron incorrectas.",
      "Las preguntas de asociación entre objetos y lugares, que presentaban la información a la vista, se respondieron correctamente.",
      "En las preguntas con información previa que luego se oculta la proporción de respuestas correctas fue menor que en las preguntas con la información a la vista.",
      "Las respuestas incorrectas llevaron en promedio más tiempo que las correctas.",
      "El mayor tiempo de respuesta se registró en una pregunta de recuerdo de la ubicación de objetos.",
      "Las preguntas fueron de nivel de dificultad intermedio.",
    ]) {
      assert.equal(findFactContradiction(s, sheet), null, s);
    }
  });

  it("los hechos generados por sessionFacts no se contradicen a sí mismos", () => {
    for (const s of facts.sentences) assert.equal(findFactContradiction(s, sheet), null, s);
  });

  it("un resultado después de \"Preguntas de X:\" se verifica contra ese tipo, no contra la sesión", () => {
    // Regresión (evaluación local 2026-11-05): splitSentences corta en ":" y
    // "todas las respuestas fueron correctas" se tomaba como afirmación global.
    assert.equal(findFactContradiction("Preguntas de asociación entre objetos y lugares (con la información a la vista): todas las respuestas fueron correctas.", sheet), null);
    assert.equal(findFactContradiction("Preguntas de recuerdo de la ubicación de objetos: todas las respuestas fueron correctas.", sheet)?.claim, "type_outcome");
    // Sin encabezado de tipo, la afirmación sigue siendo global.
    assert.equal(findFactContradiction("En resumen: todas las respuestas fueron correctas.", sheet)?.claim, "all_correct");
  });

  it("rechaza el resultado invertido de un tipo de pregunta", () => {
    assert.equal(findFactContradiction("En las preguntas de recuerdo de la ubicación de objetos hubo respuestas correctas e incorrectas.", sheet)?.claim, "type_outcome");
  });

  it("rechaza la presentación equivocada de un tipo", () => {
    assert.equal(findFactContradiction("Las preguntas de recuerdo de la ubicación de objetos, con la información a la vista, se respondieron de forma incorrecta.", sheet)?.claim, "type_presentation");
  });

  it("rechaza la comparación invertida entre información previa y a la vista", () => {
    assert.equal(findFactContradiction("Las preguntas con la información a la vista tuvieron una proporción de respuestas correctas menor que las preguntas con información previa que luego se oculta.", sheet)?.claim, "stimulus_comparison");
  });

  it("rechaza tiempos invertidos, otro tipo más lento y otro nivel", () => {
    assert.equal(findFactContradiction("Las respuestas correctas llevaron en promedio más tiempo que las incorrectas.", sheet)?.claim, "latency_correct_incorrect");
    assert.equal(findFactContradiction("El mayor tiempo de respuesta se registró en una pregunta de asociación entre objetos y lugares.", sheet)?.claim, "slowest_type");
    assert.equal(findFactContradiction("Las preguntas fueron de nivel de dificultad más exigente.", sheet)?.claim, "difficulty_level");
  });

  it("los tiempos internos no cuentan como comparación entre sesiones", () => {
    // Sin comparison_metrics: antes "más tiempo" se tomaba como comparación inventada.
    assert.equal(sheet.comparison, null);
    assert.equal(findFactContradiction("Las respuestas incorrectas llevaron en promedio más tiempo que las correctas.", sheet), null);
  });

  it("mencionar sesiones anteriores sólo si existen y sin comparar resultados", () => {
    const withPrev = materials({ previous: 2 });
    const s2 = buildFactSheet(withPrev.context, withPrev.facts.sheet);
    assert.equal(findFactContradiction("Hay varias sesiones anteriores registradas de esta misma actividad.", s2), null);
    assert.equal(findFactContradiction("La precisión fue superior a la de una sesión anterior.", s2)?.claim, "comparison_without_reference");
    assert.equal(findFactContradiction("Hay sesiones anteriores registradas de esta actividad.", sheet)?.claim, "comparison_without_reference");
  });
});

describe("aspectos sugeridos (3.6)", () => {
  const m = materials();
  const ctx = {
    stems: null,
    facts: buildFactSheet(m.context, m.facts.sheet),
    reportedMood: "cansancio",
    repeated: [...m.deterministic.observations, ...m.deterministic.follow_up],
  };

  it("conserva aspectos específicos y descarta los no permitidos", () => {
    const { kept, dropped } = filterAspects([
      "Observar si en las preguntas de recuerdo de la ubicación de objetos vuelven a registrarse respuestas incorrectas.",
      "Derivar a una evaluación neuropsicológica.",
      "Revisar si la falta de atención explica los errores.",
      "Comparar 3 respuestas.",
      "Observar si en las preguntas de recuerdo de la ubicación de objetos vuelven a registrarse respuestas incorrectas.",
    ], ctx);
    assert.equal(kept.length, 1);
    assert.deepEqual(dropped.map((d) => d.reason), [
      "clinical_recommendation", "forbidden_clinical_term", "too_short", "duplicate_aspect",
    ]);
  });

  it("descarta un aspecto que repite el seguimiento automático", () => {
    const followUp = m.deterministic.follow_up[0];
    const { kept, dropped } = filterAspects([followUp], ctx);
    assert.equal(kept.length, 0);
    assert.equal(dropped[0].reason, "repeats_automatic_text");
  });
});

describe("responseValidator — contrato 3.6", () => {
  const m = materials();
  const paragraphs = [
    "La persona trabajó con Objetos de la casa, con preguntas de nivel de dificultad intermedio. Al comenzar informó sentir cansancio.",
    "La sesión se completó en su totalidad. En las preguntas de recuerdo de la ubicación de objetos, con información previa que luego se oculta, todas las respuestas fueron incorrectas. Las respuestas incorrectas llevaron en promedio más tiempo que las correctas.",
  ];

  it("une paragraphs en summary y filtra los aspectos", () => {
    const dropped = [];
    const out = parseAndValidateSessionAnalysis(JSON.stringify({
      schema_version: "3",
      paragraphs,
      aspects_to_review: [
        "Observar si en las preguntas de recuerdo de la ubicación de objetos vuelven a registrarse respuestas incorrectas.",
        "Consultar con un neurólogo.",
      ],
    }), m.context, { ...m.validationOptions, onAspectsFiltered: (d) => dropped.push(...d) });
    assert.equal(out.summary, paragraphs.join("\n\n"));
    assert.equal(out.aspects_to_review.length, 1);
    assert.equal(dropped[0].reason, "clinical_recommendation");
    assert.deepEqual(Object.keys(out).sort(), ["aspects_to_review", "schema_version", "summary"]);
  });

  it("completa schema_version si el modelo lo omite con paragraphs", () => {
    const out = parseAndValidateSessionAnalysis(JSON.stringify({ paragraphs }), m.context, m.validationOptions);
    assert.equal(out.schema_version, "3");
  });

  it("rechaza el summary si un párrafo vincula el ánimo con los resultados", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify({
        schema_version: "3",
        paragraphs: [paragraphs[0], "Debido al cansancio informado, se registraron más respuestas incorrectas."],
      }), m.context, m.validationOptions),
      (err) => err.code === CODES.SCHEMA_INVALID && err.info?.reason === "mood_or_state_claim",
    );
  });

  it("rechaza un párrafo que es la lista de aspectos volcada en el texto", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify({
        schema_version: "3",
        paragraphs: [...paragraphs, "Observar el tiempo de las respuestas incorrectas en las próximas sesiones."],
      }), m.context, m.validationOptions),
      (err) => err.code === CODES.SCHEMA_INVALID && err.info?.reason === "malformed_summary",
    );
  });

  it("descarta aspectos con objetivos de mejora o relaciones causales no medidas", () => {
    for (const a of [
      "Observar las preguntas de recuerdo de la ubicación de objetos, para mejorar la precisión en las próximas sesiones.",
      "Revisar el tiempo de las respuestas incorrectas, para entender mejor el impacto del tiempo de respuesta en la precisión.",
      "Comparar el tiempo de las respuestas incorrectas para identificar áreas de mejora.",
    ]) {
      assert.ok(findForbiddenClaim(a), a);
    }
  });

  it("rechaza un párrafo truncado", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify({
        schema_version: "3", paragraphs: [paragraphs[0], "La sesión de entrenamiento cognitivo "],
      }), m.context, m.validationOptions),
      (err) => err.info?.reason === "malformed_summary",
    );
  });

  it("sin acceptParagraphs, paragraphs sigue siendo un campo no permitido", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify({ schema_version: "3", paragraphs }), m.context, {}),
      (err) => err.code === CODES.UNEXPECTED_FIELD,
    );
  });
});

describe("revisión al leer — contrato 3.6", () => {
  const m = materials();
  const base = {
    schema_version: "3",
    activities: [{ slug: "atencion_visual", name: "Objetos de la casa", cognitive_domain_slugs: ["atencion"] }],
    evidence: [
      { scope: "global", metric: "total_questions", value: 4 },
      { scope: "global", metric: "correct_answers", value: 2 },
      { scope: "global", metric: "incorrect_answers", value: 2 },
      { scope: "global", metric: "completion_rate", value: 1 },
    ],
    ...m.persistExtras,
  };

  it("persistExtras marca el contrato y guarda los hechos que vio el modelo", () => {
    assert.equal(m.persistExtras.ai_contract, AI_CONTRACT_V36);
    assert.ok(m.persistExtras.context_facts.length > 0);
    assert.equal(m.persistExtras.facts_sheet.mood, "cansancio");
  });

  it("muestra summary y aspectos que cumplen; filtra los que no", () => {
    const content = {
      ...base,
      summary: "Al comenzar, la persona informó sentir cansancio.\n\nEn las preguntas de recuerdo de la ubicación de objetos todas las respuestas fueron incorrectas.",
      aspects_to_review: [
        "Observar si en las preguntas de recuerdo de la ubicación de objetos vuelven a registrarse respuestas incorrectas.",
        "Evaluar un posible deterioro.",
      ],
    };
    assert.deepEqual(reviewStoredAnalysis(content), { compliant: true, reasons: [] });
    const out = withholdNonCompliantText(content);
    assert.equal(out.withheld, false);
    assert.equal(out.content.summary, content.summary);
    assert.equal(out.content.aspects_to_review.length, 1);
  });

  it("retiene summary y aspectos si el summary no cumple", () => {
    const content = { ...base, summary: "Se observan signos de deterioro cognitivo.", aspects_to_review: ["Observar los tiempos de respuesta en próximas sesiones."] };
    const out = withholdNonCompliantText(content);
    assert.equal(out.withheld, true);
    assert.equal(out.content.summary, undefined);
    assert.deepEqual(out.content.aspects_to_review, []);
  });

  it("un análisis 3.5 (sin marca de contrato) mantiene la política anterior", () => {
    const content = {
      schema_version: "3",
      activities: base.activities,
      evidence: base.evidence,
      observations: m.deterministic.observations,
      follow_up: m.deterministic.follow_up,
      summary: "La sesión fue completada en su totalidad.",
      aspects_to_review: ["Observar la próxima sesión de la actividad."],
    };
    const out = withholdNonCompliantText(content);
    assert.equal(out.withheld, false);
    assert.deepEqual(out.content.aspects_to_review, []);
  });
});
