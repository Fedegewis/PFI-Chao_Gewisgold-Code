// Tests del promptBuilder — v3.6.
//
// Cubren: shape, versión, guía de escritura en positivo (sin eco de términos
// clínicos), datos repartidos en bloques por párrafo (observaciones + hechos
// de sessionFacts), temas determinísticos para los aspectos, ausencia de
// datos técnicos (slugs, métricas, cifras, dominios) y contrato de output.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionAnalysisPrompt,
  PROMPT_BUILDER_VERSION,
  PROMPT_OUTPUT_SCHEMA_VERSION,
} from "../src/services/ai/promptBuilder.js";
import { buildSessionFacts } from "../src/services/ai/sessionFacts.js";

function metrics(overrides = {}) {
  return {
    total_questions: 4,
    answered_questions: 4,
    correct_count: 2,
    incorrect_count: 2,
    unanswered_count: 0,
    accuracy: 0.5,
    completion_rate: 1,
    mean_latency_ms: 3233,
    min_latency_ms: 2046,
    max_latency_ms: 5072,
    latency_std_ms: 1200,
    ...overrides,
  };
}

function makeCtx(extra = {}) {
  return Object.freeze({
    schema_version: "2",
    language: "es",
    duration_seconds: 21,
    patient_reported_mood: "cansancio",
    global: { metrics: metrics() },
    sections: [
      {
        slug: "orientacion_temporal",
        name: "Agenda de turnos",
        cognitive_domain_slugs: ["orientacion"],
        metrics: metrics(),
      },
    ],
    cognitive_domains_touched: ["orientacion"],
    ...extra,
  });
}

function detail(subdimension, has_stimulus, is_correct, response_time_ms) {
  return { section_slug: "orientacion_temporal", subdimension, has_stimulus, answered: true, is_correct, response_time_ms };
}

function richFacts(ctx = makeCtx()) {
  return buildSessionFacts(ctx, {
    questionDetails: [
      detail("orientacion_temporal", false, true, 2100),
      detail("orientacion_temporal", false, true, 2500),
      detail("retencion_y_evocacion", true, false, 5072),
      detail("retencion_y_evocacion", true, false, 4300),
    ],
    adaptiveLevel: 2,
    sameActivityPreviousCount: 2,
  });
}

const OBS = [
  "La sesión fue completada en su totalidad.",
  "La cantidad de respuestas correctas e incorrectas fue similar.",
  "No existen todavía sesiones comparables para describir una tendencia.",
];


function realBlock(prompt) {
  return prompt.slice(prompt.indexOf("PÁRRAFO 1"), prompt.indexOf("FORMATO DE RESPUESTA"));
}

function block(prompt, title) {
  const start = prompt.indexOf(title);
  if (start < 0) return "";
  const end = prompt.indexOf("\n\n", start);
  return prompt.slice(start, end < 0 ? undefined : end);
}

describe("promptBuilder v3.6 — shape básico", () => {
  it("retorna { prompt, promptVersion } y versión '3.6'", () => {
    const { prompt, promptVersion } = buildSessionAnalysisPrompt(makeCtx());
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 0);
    assert.equal(promptVersion, "3.6");
    assert.equal(promptVersion, PROMPT_BUILDER_VERSION);
  });

  it("schema de output es '3'", () => {
    assert.equal(PROMPT_OUTPUT_SCHEMA_VERSION, "3");
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("schema_version"));
    assert.ok(prompt.includes('"3"'));
  });

  it("incluye el nombre humano de la actividad y su descripción, sin comillas", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    assert.ok(prompt.includes("La persona realizó la actividad Agenda de turnos, que propone preguntas sobre fechas, horarios y turnos de una agenda."));
    assert.ok(!prompt.includes('"Agenda de turnos"'));
  });

  it("sin hechos enriquecidos usa sólo el nombre de la actividad", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS });
    assert.ok(prompt.includes("- La persona realizó la actividad Agenda de turnos.\n"));
  });

  it("no incluye un ejemplo de estilo copiable (el 3B copiaba su contenido)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    assert.ok(!prompt.includes("EJEMPLO"));
    assert.ok(!prompt.includes("Actividad de ejemplo"));
    assert.ok(!prompt.includes("RESPUESTA:\n{"));
  });
});

describe("promptBuilder v3.6 — sin eco de reglas de seguridad", () => {
  // El 3B reprodujo como contenido frases de la REGLA 1 de 3.4. El prompt
  // no debe nombrar los términos ni las frases que no queremos ver.
  const FORBIDDEN_IN_PROMPT = [
    "patolog", "condición clínica", "condiciones clínicas", "sesión aislada",
    "deterioro", "déficit", "demencia", "trastorno", "diagnóstic",
    "mejoría", "tratamiento", "REGLA",
  ];
  for (const term of FORBIDDEN_IN_PROMPT) {
    it(`no contiene "${term}"`, () => {
      const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
      assert.ok(!prompt.toLowerCase().includes(term.toLowerCase()), term);
    });
  }

  it("deja las explicaciones y conclusiones sobre la persona al profesional", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("corresponden al profesional: dejalas fuera del informe"));
    assert.ok(prompt.includes("Cada oración del informe cuenta un dato registrado"));
  });

  it("indica conservar la dirección y la aclaración de no comparabilidad", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("conservando el sentido y la dirección de cada dato"));
    assert.ok(prompt.includes("no es directamente comparable, decilo de esa forma"));
  });

  it("la pauta del estado de ánimo aparece sólo cuando hay un estado de ánimo registrado", () => {
    const withMood = buildSessionAnalysisPrompt(makeCtx(), { facts: richFacts() }).prompt;
    assert.ok(withMood.includes("lo que la persona informó al comenzar"));
    assert.ok(withMood.includes("sin unirlo a los resultados ni a los tiempos"));
    const noMoodCtx = makeCtx({ patient_reported_mood: null });
    const withoutMood = buildSessionAnalysisPrompt(noMoodCtx, { facts: richFacts(noMoodCtx) }).prompt;
    assert.ok(!withoutMood.includes("estado de ánimo"));
  });
});

describe("promptBuilder v3.6 — datos de la sesión por párrafo", () => {
  it("reparte las observaciones entre el párrafo de resultados y el de antecedentes", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    const p2 = block(prompt, "PÁRRAFO 2");
    const p3 = block(prompt, "PÁRRAFO 3");
    assert.ok(p2.includes("- La sesión fue completada en su totalidad."));
    assert.ok(!p2.includes("sesiones comparables"));
    assert.ok(p3.includes("- No existen todavía sesiones comparables para describir una tendencia."));
    assert.ok(p3.includes("- Hay varias sesiones anteriores registradas de esta misma actividad."));
  });

  it("párrafo 1: actividad, nivel y estado de ánimo informado", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    const p1 = block(prompt, "PÁRRAFO 1");
    assert.ok(p1.includes("Las preguntas correspondieron al nivel de dificultad intermedio."));
    assert.ok(p1.includes("Al comenzar, la persona informó sentir cansancio."));
  });

  it("párrafo 2: tipos de preguntas en prosa y tiempos", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    const p2 = block(prompt, "PÁRRAFO 2");
    assert.ok(p2.includes("En las preguntas de fechas, horarios y turnos, con la información a la vista, todas las respuestas fueron correctas."));
    assert.ok(p2.includes("En las preguntas de recuerdo de información presentada, que presentaban información previa que luego se ocultaba, todas las respuestas fueron incorrectas."));
    assert.ok(p2.includes("Las respuestas incorrectas llevaron en promedio más tiempo que las correctas."));
  });

  it("sin antecedentes no hay párrafo 3 y la plantilla pide dos párrafos", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("PÁRRAFO 3"));
    assert.ok(prompt.includes('"paragraphs": ["<párrafo 1>", "<párrafo 2>"]'));
  });

  it("con antecedentes la plantilla pide tres párrafos", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    assert.ok(prompt.includes('"paragraphs": ["<párrafo 1>", "<párrafo 2>", "<párrafo 3>"]'));
  });

  it("sin observaciones usa un hecho neutro de respaldo", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(block(prompt, "PÁRRAFO 2").includes("- La sesión fue registrada."));
  });

  it("el estado de ánimo sólo llega con los hechos enriquecidos (nunca desde el contexto crudo)", () => {
    const withMood = buildSessionAnalysisPrompt(makeCtx()).prompt;
    const withoutMood = buildSessionAnalysisPrompt(makeCtx({ patient_reported_mood: null })).prompt;
    assert.equal(withMood, withoutMood);
    assert.ok(!realBlock(withMood).includes("cansancio"));
    const noMoodFacts = richFacts(makeCtx({ patient_reported_mood: null }));
    assert.ok(!realBlock(buildSessionAnalysisPrompt(makeCtx(), { facts: noMoodFacts }).prompt).includes("informó sentir"));
  });
});

describe("promptBuilder v3.6 — temas para seguimiento", () => {
  it("lista los temas determinísticos y la plantilla pide un punto por tema", () => {
    const facts = richFacts();
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts });
    const topics = block(prompt, "TEMAS PARA SEGUIMIENTO:");
    assert.ok(facts.blocks.topics.length >= 3);
    for (const t of facts.blocks.topics) assert.ok(topics.includes(`- ${t}`), t);
    const placeholders = facts.blocks.topics.map((_, i) => `"<punto ${i + 1}>"`).join(", ");
    assert.ok(prompt.includes(`"aspects_to_review": [${placeholders}]`));
  });

  it("los temas nombran tipos con resultados no todos correctos, los tiempos y el ánimo informado", () => {
    const topics = richFacts().blocks.topics;
    assert.ok(topics.some((t) => t.startsWith("las preguntas de recuerdo de información presentada")));
    assert.ok(topics.some((t) => t.startsWith("el tiempo de las respuestas incorrectas")));
    assert.ok(topics.some((t) => t.includes("estado de ánimo") && t.includes("cansancio")));
    assert.ok(topics.length <= 5);
  });

  it("sin temas no hay bloque de temas", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS });
    assert.ok(!prompt.includes("TEMAS PARA SEGUIMIENTO:\n"));
  });
});

describe("promptBuilder v3.6 — NO filtra datos técnicos al modelo", () => {
  it("NO contiene slugs técnicos, dominios ni bloques de contratos anteriores", () => {
    const ctx = makeCtx({
      previous_sessions: [
        { section_slugs: ["orientacion_temporal"], cognitive_domain_slugs: ["orientacion"], global_metrics: metrics() },
      ],
      comparison_metrics: {
        reference: { days_before: 2 },
        accuracy: { current: 0.5, previous: 0.4, delta_percentage_points: 10, direction: "subió" },
        difficulty_level: { current: 3, previous: 1, same: false },
      },
    });
    const { prompt } = buildSessionAnalysisPrompt(ctx, { observations: OBS, facts: richFacts(ctx) });
    for (const t of ["VALID_SECTION_SLUGS", "PATIENT_REPORTED_MOOD", "PREVIOUS_SESSIONS", "COMPARISON", "previa_comparable",
      "orientacion_temporal", "retencion_y_evocacion", "cognitive_domain_slugs", "[orientacion]", "difficulty_level"]) {
      assert.ok(!prompt.includes(t), t);
    }
  });

  it("NO envía métricas ni cifras crudas: el bloque de datos no tiene dígitos", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    for (const t of ["METRICS:", "total_questions", "correct_count", "accuracy", "completion_rate", "mean_latency_ms", "3233", "5072"]) {
      assert.ok(!prompt.includes(t), t);
    }
    // Los títulos de bloque ("PÁRRAFO 1") llevan número; los datos no.
    const dataLines = realBlock(prompt).split("\n").filter((l) => l.startsWith("- "));
    assert.ok(dataLines.length > 0);
    for (const l of dataLines) assert.ok(!/\d/.test(l), l);
    assert.ok(!/nivel \d/.test(prompt));
  });
});

describe("promptBuilder v3.6 — contrato de output", () => {
  it("pide schema_version, paragraphs y aspects_to_review", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("exactamente estos tres campos"));
    assert.ok(prompt.includes('"paragraphs"'));
    assert.ok(prompt.includes('"aspects_to_review"'));
    assert.ok(prompt.includes("un párrafo por cada bloque PÁRRAFO"));
    assert.ok(prompt.includes("un punto por cada tema del bloque TEMAS PARA SEGUIMIENTO"));
  });

  it("no menciona campos de contratos anteriores", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("observations_by_section"));
    assert.ok(!prompt.includes("evidence"));
  });

  it("prohíbe cifras numéricas en el texto", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("No escribas números ni porcentajes"));
  });
});

describe("promptBuilder v3.6 — errores", () => {
  it("lanza si no hay context", () => {
    assert.throws(() => buildSessionAnalysisPrompt(null), /obligatorio/);
  });

  it("lanza si sections está vacío", () => {
    const ctx = { ...makeCtx(), sections: [] };
    assert.throws(() => buildSessionAnalysisPrompt(ctx), /sections/);
  });
});
