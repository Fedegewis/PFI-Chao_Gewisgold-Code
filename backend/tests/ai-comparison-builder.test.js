// BUG-11 — Comparación determinística backend-side.
// Verifica subió/bajó/igual, ausencia de comparables, latencia, puntos
// porcentuales, y que la actual se compare contra la MÁS RECIENTE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComparisonMetrics } from "../src/services/ai/comparisonBuilder.js";

function prev({ accuracy, mean_latency_ms, completion_rate = 1, created_at = "2026-10-10T10:00:00Z" } = {}) {
  return {
    created_at,
    duration_seconds: 60,
    global_metrics: { accuracy, mean_latency_ms, completion_rate },
    section_slugs: ["memoria_de_trabajo"],
    cognitive_domain_slugs: ["memoria"],
    days_before: 2,
  };
}

describe("comparisonBuilder — BUG-11", () => {
  it("sin comparables → null (no inventa comparación)", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.5, mean_latency_ms: 3000, completion_rate: 1 },
      comparableSessions: [],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r, null);
  });

  it("precisión bajó: 44.44% actual vs 50% previa → direction=bajó, delta_pp=-5.56", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.4444, mean_latency_ms: 3000, completion_rate: 1 },
      comparableSessions: [prev({ accuracy: 0.5, mean_latency_ms: 3000 })],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r.accuracy.direction, "bajó");
    assert.equal(r.accuracy.current, 0.4444);
    assert.equal(r.accuracy.previous, 0.5);
    assert.ok(Math.abs(r.accuracy.delta_percentage_points - (-5.56)) < 0.01);
  });

  it("precisión subió: 60% vs 50% → direction=subió", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.6, mean_latency_ms: 3000, completion_rate: 1 },
      comparableSessions: [prev({ accuracy: 0.5, mean_latency_ms: 3000 })],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r.accuracy.direction, "subió");
    assert.ok(Math.abs(r.accuracy.delta_percentage_points - 10) < 0.01);
  });

  it("precisión igual dentro del umbral (±2 pp): 51% vs 50% → direction=igual", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.51, mean_latency_ms: 3000, completion_rate: 1 },
      comparableSessions: [prev({ accuracy: 0.5, mean_latency_ms: 3000 })],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r.accuracy.direction, "igual");
  });

  it("latencia subió: 5000 ms vs 3000 ms → direction=subió, delta_ms=+2000", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.5, mean_latency_ms: 5000, completion_rate: 1 },
      comparableSessions: [prev({ accuracy: 0.5, mean_latency_ms: 3000 })],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r.mean_latency_ms.direction, "subió");
    assert.equal(r.mean_latency_ms.delta_ms, 2000);
  });

  it("latencia bajó: 3000 ms vs 5000 ms → direction=bajó", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.5, mean_latency_ms: 3000, completion_rate: 1 },
      comparableSessions: [prev({ accuracy: 0.5, mean_latency_ms: 5000 })],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r.mean_latency_ms.direction, "bajó");
    assert.equal(r.mean_latency_ms.delta_ms, -2000);
  });

  it("usa la previa MÁS RECIENTE (primera del array ordenado DESC)", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: 0.5, mean_latency_ms: 3000, completion_rate: 1 },
      comparableSessions: [
        prev({ accuracy: 0.8, mean_latency_ms: 2500, created_at: "2026-10-11T10:00:00Z" }),
        prev({ accuracy: 0.3, mean_latency_ms: 6000, created_at: "2026-10-01T10:00:00Z" }),
      ],
      sectionSlug: "memoria_de_trabajo",
    });
    // Debe comparar contra la primera (0.8), no la segunda.
    assert.equal(r.accuracy.previous, 0.8);
  });

  it("tolera accuracy como string (session_results devuelve NUMERIC)", () => {
    const r = buildComparisonMetrics({
      currentGlobal: { accuracy: "0.4444", mean_latency_ms: "5848.67", completion_rate: "1.0000" },
      comparableSessions: [prev({ accuracy: "0.8333", mean_latency_ms: "4719.33" })],
      sectionSlug: "memoria_de_trabajo",
    });
    assert.equal(r.accuracy.direction, "bajó");
    assert.ok(r.mean_latency_ms.direction === "subió");
  });
});
