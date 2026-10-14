// Tests del evidenceBuilder (schema v2).
//
// El modelo YA NO genera evidence en v2. El backend la construye
// deterministicamente desde el contexto. Estos tests cubren el shape, los
// metrics globales/por-sección y el límite máximo.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceFromContext, EVIDENCE_MAX_ENTRIES } from "../src/services/ai/evidenceBuilder.js";

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

function ctx(sections) {
  return {
    schema_version: "2",
    language: "es",
    duration_seconds: 21,
    global: { metrics: metrics() },
    sections,
    cognitive_domains_touched: [],
  };
}

describe("evidenceBuilder", () => {
  it("rechaza context nulo", () => {
    assert.throws(() => buildEvidenceFromContext(null), TypeError);
  });

  it("devuelve las 6 entradas globales esperadas (v2.3)", () => {
    const e = buildEvidenceFromContext(ctx([]));
    const globals = e.filter((x) => x.scope === "global").map((x) => x.metric);
    assert.deepEqual(globals, [
      "total_questions",
      "correct_answers",
      "incorrect_answers",
      "accuracy",
      "completion_rate",
      "mean_latency_ms",
    ]);
    // Alias semánticos: correct_answers ← correct_count, incorrect_answers ← incorrect_count.
    const correct = e.find((x) => x.scope === "global" && x.metric === "correct_answers");
    const incorrect = e.find((x) => x.scope === "global" && x.metric === "incorrect_answers");
    assert.equal(correct.value, 2);
    assert.equal(incorrect.value, 2);
  });

  it("expone duration_seconds del contexto como scope='session'", () => {
    const e = buildEvidenceFromContext(ctx([]));
    const duration = e.find((x) => x.scope === "session" && x.metric === "duration_seconds");
    assert.ok(duration);
    assert.equal(duration.value, 21);
  });

  it("expone patient_reported_mood cuando aparece en el contexto", () => {
    const c = { ...ctx([]), patient_reported_mood: "calma" };
    const e = buildEvidenceFromContext(c);
    const mood = e.find((x) => x.scope === "session" && x.metric === "patient_reported_mood");
    assert.ok(mood);
    assert.equal(mood.value, "calma");
  });

  it("omite patient_reported_mood si no está en el contexto (nunca inventa)", () => {
    const e = buildEvidenceFromContext(ctx([]));
    const mood = e.find((x) => x.metric === "patient_reported_mood");
    assert.equal(mood, undefined);
  });

  it("agrega entradas por sección cuando hay sections", () => {
    const e = buildEvidenceFromContext(ctx([
      { slug: "a", name: "A", cognitive_domain_slugs: [], metrics: metrics() },
      { slug: "b", name: "B", cognitive_domain_slugs: [], metrics: metrics({ accuracy: 0.8 }) },
    ]));
    const sectionA = e.filter((x) => x.scope === "section" && x.section_slug === "a");
    const sectionB = e.filter((x) => x.scope === "section" && x.section_slug === "b");
    assert.equal(sectionA.length, 6);
    assert.equal(sectionB.length, 6);
    assert.equal(sectionB.find((x) => x.metric === "accuracy").value, 0.8);
  });

  it("usa valores exactos del contexto, incluyendo null", () => {
    const e = buildEvidenceFromContext(ctx([
      { slug: "a", name: "A", cognitive_domain_slugs: [], metrics: metrics({ accuracy: null }) },
    ]));
    const sectionAccuracy = e.find((x) => x.scope === "section" && x.section_slug === "a" && x.metric === "accuracy");
    assert.equal(sectionAccuracy.value, null);
  });

  it("respeta el límite MAX_ENTRIES incluso con muchas sections", () => {
    const manySections = [];
    for (let i = 0; i < 20; i++) {
      manySections.push({ slug: `s${i}`, name: `S${i}`, cognitive_domain_slugs: [], metrics: metrics() });
    }
    const e = buildEvidenceFromContext(ctx(manySections));
    assert.ok(e.length <= EVIDENCE_MAX_ENTRIES);
  });

  it("no incluye metrics fuera de la whitelist aunque el contexto las tenga", () => {
    const WHITELIST = new Set([
      "total_questions", "correct_answers", "incorrect_answers",
      "accuracy", "completion_rate", "mean_latency_ms",
      "duration_seconds", "patient_reported_mood",
    ]);
    const e = buildEvidenceFromContext(ctx([]));
    for (const entry of e) {
      assert.ok(WHITELIST.has(entry.metric), `metric '${entry.metric}' fuera de whitelist`);
    }
  });
});
