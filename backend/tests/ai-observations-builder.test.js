// Tests de observationsBuilder (v3.4).
//
// Verifica cada regla de forma aislada + combinaciones realistas.
// Lenguaje: ningún output debe contener cifras, porcentajes, términos
// clínicos ni calificaciones subjetivas.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildObservations } from "../src/services/ai/observationsBuilder.js";

function metrics(overrides = {}) {
  return {
    total_questions: 9,
    answered_questions: 9,
    correct_count: 4,
    incorrect_count: 5,
    unanswered_count: 0,
    accuracy: 0.4444,
    completion_rate: 1,
    mean_latency_ms: 7800,
    min_latency_ms: 3000,
    max_latency_ms: 12000,
    latency_std_ms: 2200,
    ...overrides,
  };
}

function ctx(extra = {}) {
  return Object.freeze({
    schema_version: "2",
    language: "es",
    duration_seconds: 70,
    global: { metrics: metrics() },
    sections: [
      {
        slug: "memoria_de_trabajo",
        name: "Lista del supermercado",
        cognitive_domain_slugs: ["memoria"],
        metrics: metrics(),
      },
    ],
    cognitive_domains_touched: ["memoria"],
    ...extra,
  });
}

const FORBIDDEN_WORDS = [
  "déficit",
  "deficit",
  "deterioro",
  "capacidad",
  "capacidades",
  "mejoría",
  "mejoria",
  "excelente",
  "pobre",
  "bajo nivel",
  "alto nivel",
  "diagnóstico",
  "diagnostico",
];

function assertNoForbiddenLexicon(strings) {
  for (const s of strings) {
    for (const w of FORBIDDEN_WORDS) {
      assert.equal(
        s.toLowerCase().includes(w),
        false,
        `Frase contiene término prohibido "${w}": ${s}`
      );
    }
    // Sin cifras ni porcentajes.
    assert.equal(/\d/.test(s), false, `Frase contiene dígitos: ${s}`);
  }
}

describe("observationsBuilder — distribución de aciertos", () => {
  it("más correctas que incorrectas", () => {
    const { observations, follow_up } = buildObservations(
      ctx({ global: { metrics: metrics({ correct_count: 6, incorrect_count: 3 }) } })
    );
    assert.ok(observations.includes("Se registraron más respuestas correctas que incorrectas."));
    assert.ok(!follow_up.some((f) => f.includes("distribución de respuestas")));
    assertNoForbiddenLexicon([...observations, ...follow_up]);
  });

  it("más incorrectas que correctas → aspecto de seguimiento", () => {
    const { observations, follow_up } = buildObservations(
      ctx({ global: { metrics: metrics({ correct_count: 4, incorrect_count: 5 }) } })
    );
    assert.ok(observations.includes("Se registraron más respuestas incorrectas que correctas."));
    assert.ok(
      follow_up.includes(
        "Observar si esta distribución de respuestas se mantiene en próximas sesiones de la misma actividad."
      )
    );
    assertNoForbiddenLexicon([...observations, ...follow_up]);
  });

  it("empate de correctas e incorrectas", () => {
    const { observations } = buildObservations(
      ctx({ global: { metrics: metrics({ correct_count: 4, incorrect_count: 4, total_questions: 8 }) } })
    );
    assert.ok(observations.includes("La cantidad de respuestas correctas e incorrectas fue similar."));
  });
});

describe("observationsBuilder — completitud", () => {
  it("sesión completada en su totalidad", () => {
    const { observations } = buildObservations(ctx());
    assert.ok(observations.includes("La sesión fue completada en su totalidad."));
  });

  it("sesión incompleta → observación + follow_up específico", () => {
    const { observations, follow_up } = buildObservations(
      ctx({
        global: {
          metrics: metrics({
            answered_questions: 5,
            unanswered_count: 4,
            completion_rate: 0.5555,
          }),
        },
      })
    );
    assert.ok(observations.includes("Se registraron preguntas sin responder durante la sesión."));
    assert.ok(
      follow_up.includes(
        "Verificar si el paciente tuvo dificultades para completar la actividad en el tiempo disponible."
      )
    );
  });
});

describe("observationsBuilder — comparación histórica", () => {
  function withComparison(cm) {
    return ctx({ comparison_metrics: cm });
  }
  it("sin comparison_metrics → sin tendencia", () => {
    const { observations, follow_up } = buildObservations(ctx());
    assert.ok(observations.includes("No existen todavía sesiones comparables para describir una tendencia."));
    assert.ok(
      follow_up.includes(
        "Se requieren nuevas sesiones comparables para observar la evolución del desempeño."
      )
    );
  });

  it("precisión subió", () => {
    const { observations, follow_up } = buildObservations(
      withComparison({
        reference: { days_before: 3 },
        accuracy: { current: 0.6, previous: 0.4, delta_percentage_points: 20, direction: "subió" },
      })
    );
    assert.ok(
      observations.includes(
        "La precisión fue superior a la de una sesión anterior comparable de la misma actividad."
      )
    );
    assert.ok(
      follow_up.includes(
        "Revisar la evolución de la precisión entre sesiones comparables, considerando las diferencias en las preguntas."
      )
    );
  });

  it("precisión bajó", () => {
    const { observations } = buildObservations(
      withComparison({
        reference: { days_before: 3 },
        accuracy: { current: 0.3, previous: 0.5, delta_percentage_points: -20, direction: "bajó" },
      })
    );
    assert.ok(
      observations.includes(
        "La precisión fue inferior a la de una sesión anterior comparable de la misma actividad."
      )
    );
  });

  it("precisión igual", () => {
    const { observations } = buildObservations(
      withComparison({
        reference: { days_before: 3 },
        accuracy: { current: 0.5, previous: 0.5, delta_percentage_points: 0, direction: "igual" },
      })
    );
    assert.ok(
      observations.includes(
        "La precisión fue similar a la de una sesión anterior comparable de la misma actividad."
      )
    );
  });

  it("latencia subió → observación + follow_up", () => {
    const { observations, follow_up } = buildObservations(
      withComparison({
        reference: { days_before: 2 },
        mean_latency_ms: { current: 9000, previous: 7000, delta_ms: 2000, direction: "subió" },
      })
    );
    assert.ok(observations.includes("El tiempo promedio de respuesta aumentó respecto de una sesión comparable."));
    assert.ok(follow_up.includes("Observar el ritmo de respuesta en próximas sesiones comparables."));
  });

  it("latencia bajó", () => {
    const { observations } = buildObservations(
      withComparison({
        reference: { days_before: 2 },
        mean_latency_ms: { current: 5000, previous: 7000, delta_ms: -2000, direction: "bajó" },
      })
    );
    assert.ok(observations.includes("El tiempo promedio de respuesta disminuyó respecto de una sesión comparable."));
  });
});

describe("observationsBuilder — lenguaje adulto, no clínico, sin cifras", () => {
  it("ninguna frase contiene cifras ni términos clínicos (caso típico)", () => {
    const { observations, follow_up } = buildObservations(ctx());
    assertNoForbiddenLexicon([...observations, ...follow_up]);
    assert.ok(observations.length >= 2);
    assert.ok(follow_up.length >= 1);
  });

  it("ninguna frase contiene cifras ni términos clínicos (caso con comparación)", () => {
    const { observations, follow_up } = buildObservations(
      ctx({
        comparison_metrics: {
          reference: { days_before: 5 },
          accuracy: { current: 0.6, previous: 0.4, delta_percentage_points: 20, direction: "subió" },
          mean_latency_ms: { current: 9000, previous: 7000, delta_ms: 2000, direction: "subió" },
        },
      })
    );
    assertNoForbiddenLexicon([...observations, ...follow_up]);
  });
});

describe("observationsBuilder — determinismo", () => {
  it("dos llamadas con el mismo contexto producen la misma salida", () => {
    const a = buildObservations(ctx());
    const b = buildObservations(ctx());
    assert.deepEqual(a, b);
  });

  it("no incluye duplicados", () => {
    const { observations, follow_up } = buildObservations(ctx());
    assert.equal(new Set(observations).size, observations.length);
    assert.equal(new Set(follow_up).size, follow_up.length);
  });
});
