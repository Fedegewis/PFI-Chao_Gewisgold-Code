// Tests del promptBuilder — v3.6.
//
// Cubren: shape, versión, guía de escritura en positivo (sin eco de términos
// clínicos), datos repartidos en bloques por párrafo (hechos de
// sessionFacts; las observaciones automáticas NO se envían), cantidad de
// párrafos proporcional a los datos, temas determinísticos para los aspectos,
// ausencia de datos técnicos (slugs, métricas, cifras, dominios), contrato de
// output y JSON Schema para Ollama.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionAnalysisPrompt,
  buildOutputSchema,
  packLines,
  OUTPUT_PARAGRAPH_MAX_CHARS,
  OUTPUT_PARAGRAPHS_MAX,
  RESULT_PARAGRAPH_BUDGET,
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
    assert.equal(promptVersion, "3.7");
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
    assert.ok(prompt.includes("corresponden al profesional: dejalos fuera del informe"));
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
  it("con hechos enriquecidos NO envía las observaciones automáticas (el panel ya las muestra)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    for (const o of OBS) assert.ok(!prompt.includes(o), o);
    const p2 = block(prompt, "PÁRRAFO 2");
    assert.ok(p2.includes("- En el conjunto de la sesión hubo la misma cantidad de respuestas correctas e incorrectas."));
    const p3 = block(prompt, "PÁRRAFO 3");
    assert.ok(p3.includes("- Hay varias sesiones anteriores registradas de esta misma actividad."));
    assert.ok(p3.includes("- Entre las sesiones anteriores de esta actividad no hay una con la que esta sea comparable."));
  });

  it("la comparación con la sesión anterior llega redactada por sessionFacts", () => {
    const comparable = makeCtx({
      comparison_metrics: {
        accuracy: { current: 0.5, previous: 0.75, direction: "bajó" },
        mean_latency_ms: { current: 3000, previous: 2500, direction: "subió" },
        difficulty_level: { current: 2, previous: 2, same: true },
      },
    });
    const p3 = block(buildSessionAnalysisPrompt(comparable, { facts: richFacts(comparable) }).prompt, "PÁRRAFO 3");
    assert.ok(p3.includes("- Frente a la sesión anterior comparable de esta actividad, la precisión fue menor."));
    assert.ok(p3.includes("- Frente a esa misma sesión, el tiempo promedio de respuesta fue mayor."));

    const otherLevel = makeCtx({
      comparison_metrics: {
        accuracy: { current: 0.5, previous: 0.75, direction: "bajó" },
        difficulty_level: { current: 3, previous: 2, same: false },
      },
    });
    const p3b = block(buildSessionAnalysisPrompt(otherLevel, { facts: richFacts(otherLevel) }).prompt, "PÁRRAFO 3");
    assert.ok(p3b.includes("otro nivel de dificultad, así que la diferencia en la precisión no es directamente comparable."));
    assert.ok(!p3b.includes("fue menor"));
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
    const facts = buildSessionFacts(makeCtx(), {
      questionDetails: [detail("orientacion_temporal", false, true, 2100), detail("orientacion_temporal", false, false, 2500)],
      adaptiveLevel: 2,
      sameActivityPreviousCount: 0,
    });
    const { prompt, paragraphCount } = buildSessionAnalysisPrompt(makeCtx(), { facts });
    assert.ok(!prompt.includes("PÁRRAFO 3"));
    assert.equal(paragraphCount, 2);
    assert.ok(prompt.includes('"paragraphs": ["<párrafo 1>", "<párrafo 2>"]'));
  });

  it("sin nivel ni estado de ánimo, la actividad va con los resultados en un solo párrafo", () => {
    const ctx = makeCtx({ patient_reported_mood: null });
    const facts = buildSessionFacts(ctx, {
      questionDetails: [detail("orientacion_temporal", false, true, 2100), detail("orientacion_temporal", false, false, 2500)],
      adaptiveLevel: null,
      sameActivityPreviousCount: 0,
    });
    const { prompt, paragraphCount } = buildSessionAnalysisPrompt(ctx, { facts });
    assert.equal(paragraphCount, 1);
    assert.ok(block(prompt, "PÁRRAFO 1").includes("- La persona realizó la actividad Agenda de turnos"));
    assert.ok(block(prompt, "PÁRRAFO 1").includes("- En las preguntas de fechas, horarios y turnos"));
    assert.ok(!prompt.includes("PÁRRAFO 2"));
    assert.ok(prompt.includes('"paragraphs": ["<párrafo 1>"]'));
  });

  it("con antecedentes la plantilla pide tres párrafos", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS, facts: richFacts() });
    assert.ok(prompt.includes('"paragraphs": ["<párrafo 1>", "<párrafo 2>", "<párrafo 3>"]'));
  });

  it("sin hechos ni observaciones usa un hecho neutro de respaldo", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(block(prompt, "PÁRRAFO 1").includes("- La sesión fue registrada."));
  });

  it("sin hechos enriquecidos (respaldo) usa las observaciones", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { observations: OBS });
    assert.ok(block(prompt, "PÁRRAFO 1").includes("- La sesión fue completada en su totalidad."));
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
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), { facts: richFacts() });
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

describe("promptBuilder v3.6 — JSON Schema para Ollama (structured outputs)", () => {
  it("fija la cantidad exacta de párrafos y el máximo de aspectos", () => {
    const facts = richFacts();
    const { outputSchema, paragraphCount, topicCount } = buildSessionAnalysisPrompt(makeCtx(), { facts });
    assert.equal(paragraphCount, 3);
    assert.equal(topicCount, facts.blocks.topics.length);
    assert.equal(outputSchema.type, "object");
    assert.equal(outputSchema.additionalProperties, false);
    assert.deepEqual(outputSchema.required, ["schema_version", "paragraphs", "aspects_to_review"]);
    assert.deepEqual(outputSchema.properties.schema_version.enum, ["3"]);
    assert.equal(outputSchema.properties.paragraphs.minItems, 3);
    assert.equal(outputSchema.properties.paragraphs.maxItems, 3);
    assert.equal(outputSchema.properties.paragraphs.items.maxLength, OUTPUT_PARAGRAPH_MAX_CHARS);
    assert.equal(outputSchema.properties.aspects_to_review.maxItems, topicCount);
  });

  it("los topes del schema quedan dentro de los límites del validador", () => {
    const schema = buildOutputSchema(9, 9);
    assert.equal(schema.properties.paragraphs.maxItems, OUTPUT_PARAGRAPHS_MAX);
    assert.equal(schema.properties.aspects_to_review.maxItems, 5);
    assert.ok(schema.properties.paragraphs.items.maxLength <= 1100);
    assert.ok(schema.properties.aspects_to_review.items.maxLength <= 240);
    assert.equal(buildOutputSchema(0, 0).properties.paragraphs.minItems, 1);
    assert.equal(buildOutputSchema(2, 0).properties.aspects_to_review.maxItems, 0);
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

describe("promptBuilder v3.7 — resultados repartidos en bloques acotados", () => {
  const TYPES = [
    "orientacion_temporal", "calculo_funcional", "retencion_y_evocacion", "planificacion_secuencial",
    "juicio_y_resolucion", "comprension_funcional", "estrategia_y_autorregulacion", "orientacion_espacial",
    "reconocimiento_funcional", "atencion_selectiva",
  ];
  function manyTypes(n, previous = 0) {
    return buildSessionFacts(makeCtx(), {
      questionDetails: TYPES.slice(0, n).map((t, i) => detail(t, i % 2 === 0, i % 3 !== 0, 1500 + i * 300)),
      adaptiveLevel: 2,
      sameActivityPreviousCount: previous,
    });
  }
  function dataBlocks(prompt) {
    return prompt.slice(prompt.indexOf("PÁRRAFO 1"), prompt.indexOf("FORMATO DE RESPUESTA"))
      .split(/\n(?=PÁRRAFO \d|TEMAS PARA SEGUIMIENTO)/)
      .filter((b) => b.startsWith("PÁRRAFO"))
      .map((b) => b.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)).join(" "));
  }

  it("packLines respeta el orden y el presupuesto", () => {
    assert.deepEqual(packLines(["aaaa", "bbbb", "cccc"], 9), [["aaaa", "bbbb"], ["cccc"]]);
    assert.deepEqual(packLines(["x".repeat(20), "y"], 10), [["x".repeat(20)], ["y"]]);
    assert.deepEqual(packLines([], 10), []);
  });

  it("regresión sesiones 18/21: con muchos tipos ningún bloque de datos supera el presupuesto", () => {
    for (const n of [5, 6, 8, 10]) {
      const facts = manyTypes(n, 1);
      const { prompt, paragraphCount, outputSchema } = buildSessionAnalysisPrompt(makeCtx(), { facts });
      const blocks = dataBlocks(prompt);
      assert.equal(blocks.length, paragraphCount, `n=${n}`);
      assert.ok(paragraphCount <= OUTPUT_PARAGRAPHS_MAX, `n=${n}: ${paragraphCount} párrafos`);
      assert.equal(outputSchema.properties.paragraphs.minItems, paragraphCount);
      for (const b of blocks) assert.ok(b.length <= RESULT_PARAGRAPH_BUDGET, `n=${n}: bloque de ${b.length}`);
      // Todos los hechos de resultados llegan, en orden, sin repetirse.
      const expected = [...facts.blocks.general, ...facts.blocks.types, ...facts.blocks.times];
      const sent = blocks.slice(1, paragraphCount - 1).join(" ");
      let at = 0;
      for (const line of expected) {
        const i = sent.indexOf(line.trim(), at);
        assert.ok(i >= at, `n=${n}: falta o desordenado: ${line}`);
        at = i + line.length;
      }
    }
  });

  it("con pocos tipos sigue habiendo un único bloque de resultados", () => {
    const { paragraphCount } = buildSessionAnalysisPrompt(makeCtx(), { facts: richFacts() });
    assert.equal(paragraphCount, 3);
  });
});
