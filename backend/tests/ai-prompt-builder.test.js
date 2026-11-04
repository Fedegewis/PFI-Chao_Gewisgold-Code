// Tests del promptBuilder — v3.5.
//
// Cubren: shape, versión, guía de escritura en positivo (sin eco de términos
// clínicos), HECHOS REGISTRADOS, ausencia de datos técnicos (slugs,
// previous_sessions, patient_reported_mood, cognitive_domains), contrato
// de output mínimo.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionAnalysisPrompt,
  PROMPT_BUILDER_VERSION,
  PROMPT_OUTPUT_SCHEMA_VERSION,
} from "../src/services/ai/promptBuilder.js";

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

describe("promptBuilder v3.5 — shape básico", () => {
  it("retorna { prompt, promptVersion } y versión '3.5'", () => {
    const { prompt, promptVersion } = buildSessionAnalysisPrompt(makeCtx());
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 0);
    assert.equal(promptVersion, "3.5");
    assert.equal(promptVersion, PROMPT_BUILDER_VERSION);
  });

  it("schema de output es '3'", () => {
    assert.equal(PROMPT_OUTPUT_SCHEMA_VERSION, "3");
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("schema_version"));
    assert.ok(prompt.includes('"3"'));
  });

  it("incluye el nombre humano de la actividad", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("ACTIVIDAD: Agenda de turnos"));
    // Sin comillas dobles en los datos de la sesión (truncan el JSON).
    assert.ok(!prompt.includes('"Agenda de turnos"'));
  });

  it("el ejemplo de estilo usa una actividad ficticia, no la real", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("Actividad de ejemplo"));
    const example = prompt.slice(prompt.indexOf("EJEMPLO DE ESTILO"), prompt.indexOf("SESIÓN A SINTETIZAR"));
    assert.ok(!example.includes("Agenda de turnos"));
  });
});

describe("promptBuilder v3.5 — sin eco de reglas de seguridad", () => {
  // El 3B reprodujo como contenido frases de la REGLA 1 de 3.4. El prompt
  // 3.5 no debe nombrar los términos ni las frases que no queremos ver.
  const FORBIDDEN_IN_PROMPT = [
    "patolog", "condición clínica", "condiciones clínicas", "sesión aislada",
    "deterioro", "déficit", "demencia", "trastorno", "diagnóstic",
    "mejoría", "tratamiento", "REGLA",
  ];
  for (const term of FORBIDDEN_IN_PROMPT) {
    it(`no contiene "${term}"`, () => {
      const { prompt } = buildSessionAnalysisPrompt(makeCtx(), {
        observations: ["La sesión fue completada en su totalidad."],
      });
      assert.ok(!prompt.toLowerCase().includes(term.toLowerCase()), term);
    });
  }

  it("deja las conclusiones sobre la persona al profesional", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("corresponden exclusivamente al profesional"));
  });

  it("indica conservar la dirección y la aclaración de no comparabilidad", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("Conservá la dirección"));
    assert.ok(prompt.includes("no es directamente comparable"));
    assert.ok(prompt.includes("no hables de evolución ni de tendencia"));
  });
});

describe("promptBuilder v3.5 — NO filtra datos técnicos al modelo", () => {
  it("NO contiene VALID_SECTION_SLUGS", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("VALID_SECTION_SLUGS"));
  });

  it("NO contiene PATIENT_REPORTED_MOOD aunque el contexto lo tenga", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("PATIENT_REPORTED_MOOD"));
    assert.ok(!prompt.includes("cansancio"));
  });

  it("NO contiene PREVIOUS_SESSIONS aunque el contexto lo traiga", () => {
    const ctx = makeCtx({
      previous_sessions: [
        { section_slugs: ["orientacion_temporal"], cognitive_domain_slugs: ["orientacion"], global_metrics: metrics() },
      ],
    });
    const { prompt } = buildSessionAnalysisPrompt(ctx);
    assert.ok(!prompt.includes("PREVIOUS_SESSIONS"));
    assert.ok(!prompt.includes("PREV "));
  });

  it("NO contiene COMPARISON ni comparison_metrics", () => {
    const ctx = makeCtx({
      comparison_metrics: {
        reference: { days_before: 2 },
        accuracy: { current: 0.5, previous: 0.4, delta_percentage_points: 10, direction: "subió" },
      },
    });
    const { prompt } = buildSessionAnalysisPrompt(ctx);
    assert.ok(!prompt.includes("COMPARISON"));
    assert.ok(!prompt.includes("previa_comparable"));
  });

  it("NO contiene slugs técnicos de secciones", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("orientacion_temporal"));
  });

  it("NO contiene cognitive_domain_slugs (técnico) en el contexto enviado al modelo", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("cognitive_domain_slugs"));
    // La palabra "cognitive_domains" PUEDE aparecer en la lista de campos
    // prohibidos del OUTPUT (no agregar campos extra). Lo que no debe aparecer
    // son valores concretos como "orientacion" o slugs del catálogo.
    assert.ok(!prompt.includes("[orientacion]"));
  });
});

describe("promptBuilder v3.5 — contrato de output", () => {
  it("pide exactamente schema_version y summary (no aspects_to_review)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes('"summary"'));
    assert.ok(!prompt.includes("aspects_to_review"));
    assert.ok(prompt.includes("exactamente estos dos campos"));
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

  it("NO envía métricas ni cifras crudas al modelo", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("METRICS:"));
    assert.ok(!prompt.includes("total_questions"));
    assert.ok(!prompt.includes("correct_count"));
    assert.ok(!prompt.includes("accuracy"));
    assert.ok(!prompt.includes("completion_rate"));
    assert.ok(!prompt.includes("mean_latency_ms"));
    assert.ok(!prompt.includes("0.5"));
    assert.ok(!prompt.includes("3233"));
    assert.ok(!prompt.includes("1200"));
    // Los únicos dígitos del prompt son la numeración de la guía y el schema;
    // el bloque de la sesión real no lleva ninguno.
    const real = prompt.slice(prompt.indexOf("SESIÓN A SINTETIZAR"));
    assert.ok(!/\d/.test(real.replaceAll('"3"', "")), "sin dígitos en el bloque de la sesión");
  });

  it("NO envía niveles de dificultad (Ollama no decide ni conoce niveles)", () => {
    const ctx = makeCtx({
      comparison_metrics: { difficulty_level: { current: 3, previous: 1, same: false } },
    });
    const { prompt } = buildSessionAnalysisPrompt(ctx);
    assert.ok(!prompt.includes("difficulty_level"));
    assert.ok(!/nivel \d/.test(prompt));
  });

  it("incluye el bloque HECHOS REGISTRADOS con las observaciones", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), {
      observations: [
        "La sesión fue completada en su totalidad.",
        "Se registraron más respuestas incorrectas que correctas.",
      ],
    });
    const real = prompt.slice(prompt.indexOf("SESIÓN A SINTETIZAR"));
    assert.ok(real.includes("HECHOS REGISTRADOS:"));
    assert.ok(real.includes("- La sesión fue completada en su totalidad."));
    assert.ok(real.includes("- Se registraron más respuestas incorrectas que correctas."));
  });

  it("sin observaciones usa un hecho neutro de respaldo", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    const real = prompt.slice(prompt.indexOf("SESIÓN A SINTETIZAR"));
    assert.ok(real.includes("- La sesión fue registrada."));
  });

  it("el estado de ánimo nunca llega al modelo, esté o no presente", () => {
    const withMood = buildSessionAnalysisPrompt(makeCtx()).prompt;
    const withoutMood = buildSessionAnalysisPrompt(makeCtx({ patient_reported_mood: null })).prompt;
    assert.equal(withMood, withoutMood);
    assert.ok(!withMood.includes("cansancio"));
  });
});

describe("promptBuilder v3.5 — errores", () => {
  it("lanza si no hay context", () => {
    assert.throws(() => buildSessionAnalysisPrompt(null), /obligatorio/);
  });

  it("lanza si sections está vacío", () => {
    const ctx = { ...makeCtx(), sections: [] };
    assert.throws(() => buildSessionAnalysisPrompt(ctx), /sections/);
  });
});
