// P1 — comparaciones entre sesiones con distinto nivel de dificultad
// (comparisonBuilder + observationsBuilder). Funciones puras, sin DB.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComparisonMetrics } from "../src/services/ai/comparisonBuilder.js";
import { buildObservations } from "../src/services/ai/observationsBuilder.js";
import { parseAndValidateSessionAnalysis } from "../src/services/ai/responseValidator.js";

function prev(accuracy, adaptiveLevel) {
  return {
    duration_seconds: 60,
    global_metrics: { accuracy, mean_latency_ms: 3000, completion_rate: 1 },
    section_slugs: ["funciones_ejecutivas"],
    cognitive_domain_slugs: ["funciones_ejecutivas"],
    days_before: 1,
    ...(adaptiveLevel !== undefined ? { adaptive_level: adaptiveLevel } : {}),
  };
}

function compare(currentAccuracy, previous, currentAdaptiveLevel) {
  return buildComparisonMetrics({
    currentGlobal: { accuracy: currentAccuracy, mean_latency_ms: 3000, completion_rate: 1 },
    comparableSessions: [previous],
    sectionSlug: "funciones_ejecutivas",
    ...(currentAdaptiveLevel !== undefined ? { currentAdaptiveLevel } : {}),
  });
}

function ctxWith(cm) {
  const metrics = { total_questions: 4, answered_questions: 4, correct_count: 2, incorrect_count: 2, unanswered_count: 0, accuracy: 0.5, completion_rate: 1 };
  return { global: { metrics }, sections: [], comparison_metrics: cm };
}

describe("comparisonBuilder — nivel de dificultad (P1)", () => {
  it("sesiones históricas (sin nivel): salida idéntica a la previa al mecanismo", () => {
    const r = compare(0.5, prev(0.25));
    assert.equal("difficulty_level" in r, false);
    assert.equal(r.accuracy.direction, "subió");
  });

  it("mismo nivel → same = true", () => {
    const r = compare(0.5, prev(0.25, 2), 2);
    assert.deepEqual(r.difficulty_level, { current: 2, previous: 2, same: true });
  });

  it("distinto nivel → same = false y la métrica aritmética no cambia", () => {
    const r = compare(0.5, prev(0.75, 2), 3);
    assert.deepEqual(r.difficulty_level, { current: 3, previous: 2, same: false });
    assert.equal(r.accuracy.direction, "bajó");
    assert.equal(r.accuracy.delta_percentage_points, -25);
  });

  it("una sola de las dos con nivel → same = null", () => {
    assert.deepEqual(compare(0.5, prev(0.25, null), 2).difficulty_level, { current: 2, previous: null, same: null });
    assert.deepEqual(compare(0.5, prev(0.25, 1)).difficulty_level, { current: null, previous: 1, same: null });
  });

  it("valores fuera de rango se tratan como sin nivel", () => {
    assert.equal("difficulty_level" in compare(0.5, prev(0.25, 7), 0), false);
  });
});

describe("observationsBuilder — nivel de dificultad (P1)", () => {
  it("mismo nivel: conserva la descripción de subida/bajada", () => {
    const { observations } = buildObservations(ctxWith(compare(0.5, prev(0.25, 2), 2)));
    assert.ok(observations.includes("La precisión fue superior a la de una sesión anterior comparable de la misma actividad."));
  });

  it("distinto nivel: aclara la diferencia y no describe subida ni bajada", () => {
    const { observations, follow_up } = buildObservations(ctxWith(compare(0.5, prev(0.75, 2), 3)));
    const text = observations.join(" ");
    assert.ok(text.includes("nivel de dificultad distinto"));
    assert.equal(/precisión fue (superior|inferior|similar)/.test(text), false);
    assert.ok(follow_up.some((f) => f.includes("nivel de dificultad")));
  });

  it("nivel desconocido en una de las sesiones: también se aclara", () => {
    const { observations } = buildObservations(ctxWith(compare(0.5, prev(0.25, null), 2)));
    assert.ok(observations.some((o) => o.includes("no tiene un nivel de dificultad registrado")));
  });

  it("sin nivel en ninguna (histórico): comportamiento previo intacto", () => {
    const { observations } = buildObservations(ctxWith(compare(0.5, prev(0.25))));
    assert.ok(observations.includes("La precisión fue superior a la de una sesión anterior comparable de la misma actividad."));
  });

  it("las frases nuevas pasan las validaciones semánticas del output IA si el modelo las parafrasea", () => {
    const { observations } = buildObservations(ctxWith(compare(0.5, prev(0.75, 2), 3)));
    for (const o of observations) {
      assert.equal(/\d/.test(o), false, `cifra en: ${o}`);
      const raw = JSON.stringify({ schema_version: "3", summary: `En Ordenar una receta: ${o}`, aspects_to_review: [] });
      assert.doesNotThrow(() => parseAndValidateSessionAnalysis(raw, {}), o);
    }
  });
});
