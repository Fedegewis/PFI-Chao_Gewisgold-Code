// Tests del promptBuilder — v3.0.
//
// Cubren: shape, versión, 5 reglas, ausencia de datos técnicos (slugs,
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

describe("promptBuilder v3 — shape básico", () => {
  it("retorna { prompt, promptVersion } y versión '3.4'", () => {
    const { prompt, promptVersion } = buildSessionAnalysisPrompt(makeCtx());
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 0);
    assert.equal(promptVersion, "3.4");
    assert.equal(promptVersion, PROMPT_BUILDER_VERSION);
  });

  it("schema de output es '3'", () => {
    assert.equal(PROMPT_OUTPUT_SCHEMA_VERSION, "3");
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes('schema_version'));
    assert.ok(prompt.includes('"3"'));
  });

  it("incluye las 5 reglas", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("REGLA 1"));
    assert.ok(prompt.includes("REGLA 2"));
    assert.ok(prompt.includes("REGLA 3"));
    assert.ok(prompt.includes("REGLA 4"));
    assert.ok(prompt.includes("REGLA 5"));
    assert.ok(!prompt.includes("REGLA 6"));
  });

  it("incluye el nombre humano de la actividad", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("Agenda de turnos"));
  });
});

describe("promptBuilder v3 — NO filtra datos técnicos al modelo", () => {
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

describe("promptBuilder v3 — contrato de output", () => {
  it("incluye los dos campos del contrato", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("summary"));
    assert.ok(prompt.includes("aspects_to_review"));
  });

  it("prohibe explícitamente los campos del contrato v2", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("observations_by_section"));
    assert.ok(prompt.includes("comparison"));
    assert.ok(prompt.includes("evidence"));
    assert.ok(prompt.toLowerCase().includes("no agregues"));
  });

  it("prohibe cifras numéricas en el texto", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.toLowerCase().includes("cifras") || prompt.includes("porcentajes"));
  });

  it("pide 1-2 oraciones breves y menciona el máximo 1000", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.toUpperCase().includes("UNA O DOS"));
    assert.ok(prompt.includes("1000"));
    assert.ok(prompt.includes("100") && prompt.includes("250"));
  });

  it("v3.3: NO envía la línea METRICS ni cifras crudas al modelo", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("METRICS:"));
    assert.ok(!prompt.includes("total_questions="));
    assert.ok(!prompt.includes("correct_count="));
    assert.ok(!prompt.includes("accuracy="));
    assert.ok(!prompt.includes("completion_rate="));
    assert.ok(!prompt.includes("mean_latency_ms="));
    // Y además, los valores crudos tampoco deben aparecer: 0.5, 3233, 1200.
    assert.ok(!prompt.includes("0.5"));
    assert.ok(!prompt.includes("3233"));
    assert.ok(!prompt.includes("1200"));
  });

  it("v3.3+: sigue incluyendo nombres humanos de las actividades", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("Agenda de turnos"));
    assert.ok(prompt.includes("SESSION activities="));
  });

  it("v3.4: incluye el bloque OBSERVATIONS cuando se pasan observations", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), {
      observations: [
        "La sesión fue completada en su totalidad.",
        "Se registraron más respuestas incorrectas que correctas.",
      ],
    });
    assert.ok(prompt.includes("OBSERVATIONS:"));
    assert.ok(prompt.includes("- La sesión fue completada en su totalidad."));
    assert.ok(prompt.includes("- Se registraron más respuestas incorrectas que correctas."));
  });

  it("v3.4: omite OBSERVATIONS si no se pasan observations", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!prompt.includes("OBSERVATIONS:"));
  });

  it("v3.4: pide parafrasear OBSERVATIONS, no inventar", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx(), {
      observations: ["La sesión fue completada en su totalidad."],
    });
    assert.ok(prompt.toUpperCase().includes("PARAFRASE"));
  });

  it("v3.4: prohibe atribuir afirmaciones al profesional", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.toLowerCase().includes("el profesional"));
    // Y aparece en la REGLA 3.
    assert.ok(prompt.includes("REGLA 3"));
  });
});

describe("promptBuilder v3 — errores", () => {
  it("lanza si no hay context", () => {
    assert.throws(() => buildSessionAnalysisPrompt(null), /obligatorio/);
  });

  it("lanza si sections está vacío", () => {
    const ctx = { ...makeCtx(), sections: [] };
    assert.throws(() => buildSessionAnalysisPrompt(ctx), /sections/);
  });
});
