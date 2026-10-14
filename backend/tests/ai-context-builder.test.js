// 7D: tests unitarios de contextBuilder — sin DB, sin Ollama, sin fixtures reales.
// Los inputs simulan filas ya proyectadas de session_results + metadata de sections
// + slugs de dominios cognitivos, como las produciría el caller de 7G.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionAnalysisContext,
  CONTEXT_SCHEMA_VERSION,
  CONTEXT_WHITELIST_METRICS,
} from "../src/services/ai/contextBuilder.js";

const REQUIRED_METRIC_FIELDS = [
  "total_questions",
  "answered_questions",
  "correct_count",
  "incorrect_count",
  "unanswered_count",
  "accuracy",
  "completion_rate",
  "mean_latency_ms",
  "min_latency_ms",
  "max_latency_ms",
  "latency_std_ms",
];

function makeMetricsRow(overrides = {}) {
  return {
    total_questions: 5,
    answered_questions: 5,
    correct_count: 4,
    incorrect_count: 1,
    unanswered_count: 0,
    accuracy: 0.8,
    completion_rate: 1,
    mean_latency_ms: 4200,
    min_latency_ms: 2100,
    max_latency_ms: 6300,
    latency_std_ms: 1200.5,
    ...overrides,
  };
}

function makeValidInput(extra = {}) {
  return {
    session: { duration_seconds: 300 },
    global: makeMetricsRow(),
    sections: [
      {
        slug: "atencion_visual",
        name: "Objetos de la casa",
        cognitive_domain_slugs: ["atencion", "memoria"],
        result: makeMetricsRow({ correct_count: 3, incorrect_count: 2, accuracy: 0.6 }),
      },
    ],
    ...extra,
  };
}

describe("contextBuilder — happy path & determinismo", () => {
  it("produce shape con schema_version, duration_seconds, global, sections, cognitive_domains_touched", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput());
    assert.equal(ctx.schema_version, CONTEXT_SCHEMA_VERSION);
    assert.equal(ctx.language, "es");
    // AJUSTE 7E §0: session.id NO se expone al boundary IA.
    assert.equal(ctx.session, undefined);
    assert.equal(ctx.duration_seconds, 300);
    // AJUSTE 7G §4: patient removido del boundary IA.
    assert.equal(ctx.patient, undefined);
    assert.ok(ctx.global && ctx.global.metrics);
    assert.equal(ctx.sections.length, 1);
    assert.deepEqual(ctx.cognitive_domains_touched, ["atencion", "memoria"]);
  });

  it("no filtra session.id ni identificadores internos al contexto (ajuste 7E §0)", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput());
    const json = JSON.stringify(ctx);
    assert.ok(!json.includes("\"id\""), "el contexto no debe exponer session.id");
    assert.ok(!json.includes("\"session_id\""));
  });

  it("es determinístico: mismos inputs producen misma salida", () => {
    const a = buildSessionAnalysisContext(makeValidInput());
    const b = buildSessionAnalysisContext(makeValidInput());
    assert.deepEqual(a, b);
  });

  it("ordena sections por slug y dedupe/ordena dominios", () => {
    const input = makeValidInput();
    input.sections = [
      {
        slug: "orientacion_espacial",
        name: "Camino al barrio",
        cognitive_domain_slugs: ["orientacion"],
        result: makeMetricsRow(),
      },
      {
        slug: "atencion_visual",
        name: "Objetos de la casa",
        cognitive_domain_slugs: ["memoria", "atencion", "atencion"], // duplicado
        result: makeMetricsRow(),
      },
    ];
    const ctx = buildSessionAnalysisContext(input);
    assert.deepEqual(
      ctx.sections.map((s) => s.slug),
      ["atencion_visual", "orientacion_espacial"]
    );
    assert.deepEqual(ctx.sections[0].cognitive_domain_slugs, ["atencion", "memoria"]);
    assert.deepEqual(ctx.cognitive_domains_touched, ["atencion", "memoria", "orientacion"]);
  });

  it("no muta el input", () => {
    const input = makeValidInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    buildSessionAnalysisContext(input);
    assert.deepEqual(input, snapshot);
  });

  it("congela superficialmente el output", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput());
    assert.ok(Object.isFrozen(ctx));
  });
});

describe("contextBuilder — whitelist / minimización", () => {
  it("expone exactamente los campos de métricas whitelisteados", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput());
    assert.deepEqual(Object.keys(ctx.global.metrics).sort(), [...REQUIRED_METRIC_FIELDS].sort());
    assert.deepEqual(Object.keys(ctx.sections[0].metrics).sort(), [...REQUIRED_METRIC_FIELDS].sort());
    assert.deepEqual(CONTEXT_WHITELIST_METRICS.slice().sort(), [...REQUIRED_METRIC_FIELDS].sort());
  });

  it("ignora campos extra del input global (no aparecen en el ctx)", () => {
    const input = makeValidInput();
    input.global = {
      ...makeMetricsRow(),
      // Basura que podría venir si el caller pasa el row entero por error:
      id: 123,
      session_id: 42,
      section_id: null,
      created_at: new Date("2026-09-10T00:00:00Z"),
      professional_id: 999,       // dato sensible que NO debe filtrarse
      correct_answer_snapshot: 2, // no existe en session_results; test defensivo
    };
    const ctx = buildSessionAnalysisContext(input);
    assert.equal(ctx.global.metrics.id, undefined);
    assert.equal(ctx.global.metrics.session_id, undefined);
    assert.equal(ctx.global.metrics.created_at, undefined);
    assert.equal(ctx.global.metrics.professional_id, undefined);
    assert.equal(ctx.global.metrics.correct_answer_snapshot, undefined);
  });

  it("no incluye PII ni IDs sensibles en ningún nivel", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      patient: { age: 72 },
    }));
    const json = JSON.stringify(ctx);
    // Nota: `section.name` es metadata legítima del catálogo de secciones
    // (título "Objetos de la casa") — no PII del paciente. Por eso NO
    // aparece la clave `"name"` como prohibida acá.
    for (const forbidden of [
      "\"email\"", "\"password\"", "\"password_hash\"",
      "\"google_id\"", "\"professional_id\"", "\"patient_id\"",
      "\"correct_answer\"", "\"correct_answer_snapshot\"",
      "\"feedback_correct\"", "\"feedback_incorrect\"",
      "\"prompt_snapshot\"", "\"stimulus_snapshot\"",
      "\"selected_answer\"", "\"answered_at\"", "\"invitation\"",
      "\"token\"", "\"jwt\"",
    ]) {
      assert.ok(!json.includes(forbidden), `contexto no debería incluir ${forbidden}`);
    }
  });

  it("no inventa clasificaciones cualitativas para latencia (§6, hallazgo 7B)", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ mean_latency_ms: 4200 }),
    }));
    const json = JSON.stringify(ctx).toLowerCase();
    for (const word of ["fast", "slow", "rápido", "rapido", "lento", "normal", "anormal"]) {
      assert.ok(!json.includes(word), `contexto NO puede clasificar latencia como '${word}'`);
    }
  });

  it("no inventa clasificaciones cualitativas para accuracy", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ accuracy: 0.72 }),
    }));
    const json = JSON.stringify(ctx).toLowerCase();
    for (const word of ["bueno", "malo", "prometedor", "preocupante", "óptimo", "optimo"]) {
      assert.ok(!json.includes(word), `contexto NO puede clasificar accuracy como '${word}'`);
    }
  });
});

describe("contextBuilder — tipos y coerción", () => {
  it("acepta métricas como strings numéricos (pg NUMERIC → string) y las normaliza a number", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      global: {
        ...makeMetricsRow(),
        accuracy: "0.8000",
        completion_rate: "1.0000",
        mean_latency_ms: "4200.00",
        latency_std_ms: "1200.50",
      },
    }));
    assert.equal(typeof ctx.global.metrics.accuracy, "number");
    assert.equal(ctx.global.metrics.accuracy, 0.8);
    assert.equal(ctx.global.metrics.mean_latency_ms, 4200);
    assert.equal(ctx.global.metrics.latency_std_ms, 1200.5);
  });

  it("acepta accuracy null cuando session_results.accuracy es null (sin scored answers)", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ accuracy: null }),
    }));
    assert.equal(ctx.global.metrics.accuracy, null);
  });

  it("acepta 0 como métrica válida (correct_count=0, accuracy=0)", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ correct_count: 0, incorrect_count: 5, accuracy: 0 }),
    }));
    assert.equal(ctx.global.metrics.correct_count, 0);
    assert.equal(ctx.global.metrics.accuracy, 0);
  });

  it("rechaza métricas no numéricas parseables", () => {
    assert.throws(() => buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ accuracy: "abc" }),
    })), TypeError);
    assert.throws(() => buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ mean_latency_ms: {} }),
    })), TypeError);
    assert.throws(() => buildSessionAnalysisContext(makeValidInput({
      global: makeMetricsRow({ mean_latency_ms: Number.POSITIVE_INFINITY }),
    })), TypeError);
  });
});

describe("contextBuilder — precondiciones", () => {
  it("exige input", () => {
    assert.throws(() => buildSessionAnalysisContext(), TypeError);
    assert.throws(() => buildSessionAnalysisContext(null), TypeError);
    assert.throws(() => buildSessionAnalysisContext(42), TypeError);
  });

  it("acepta input sin session (todo opcional)", () => {
    const input = makeValidInput();
    delete input.session;
    const ctx = buildSessionAnalysisContext(input);
    assert.equal(ctx.duration_seconds, null);
  });

  it("exige session.duration_seconds >= 0 o null", () => {
    assert.throws(() => buildSessionAnalysisContext({
      ...makeValidInput(), session: { duration_seconds: -5 },
    }), TypeError);
    // null OK
    const ctx = buildSessionAnalysisContext({
      ...makeValidInput(), session: { duration_seconds: null },
    });
    assert.equal(ctx.duration_seconds, null);
  });

  it("exige sections no vacío", () => {
    assert.throws(() => buildSessionAnalysisContext({
      ...makeValidInput(), sections: [],
    }), TypeError);
  });

  it("exige campos de métricas presentes en global", () => {
    const bad = makeValidInput();
    delete bad.global.accuracy;
    assert.throws(() => buildSessionAnalysisContext(bad), /accuracy/);
  });

  it("exige campos de métricas presentes en cada section.result", () => {
    const bad = makeValidInput();
    delete bad.sections[0].result.completion_rate;
    assert.throws(() => buildSessionAnalysisContext(bad), /completion_rate/);
  });

  it("exige section.slug y section.name no vacíos, cognitive_domain_slugs array", () => {
    const bad1 = makeValidInput();
    bad1.sections[0].slug = "";
    assert.throws(() => buildSessionAnalysisContext(bad1), TypeError);

    const bad2 = makeValidInput();
    bad2.sections[0].name = "";
    assert.throws(() => buildSessionAnalysisContext(bad2), TypeError);

    const bad3 = makeValidInput();
    bad3.sections[0].cognitive_domain_slugs = "atencion";
    assert.throws(() => buildSessionAnalysisContext(bad3), TypeError);
  });

  it("acepta section sin dominios (array vacío)", () => {
    const input = makeValidInput();
    input.sections[0].cognitive_domain_slugs = [];
    const ctx = buildSessionAnalysisContext(input);
    assert.deepEqual(ctx.sections[0].cognitive_domain_slugs, []);
    assert.deepEqual(ctx.cognitive_domains_touched, []);
  });
});

describe("contextBuilder — patient_reported_mood (v1.5)", () => {
  it("incluye mood válido cuando el caller lo pasa", () => {
    const base = makeValidInput();
    const ctx = buildSessionAnalysisContext({
      ...base,
      session: { ...base.session, patient_reported_mood: "cansancio" },
    });
    assert.equal(ctx.patient_reported_mood, "cansancio");
  });

  it("omite patient_reported_mood cuando es null (no inventa)", () => {
    const base = makeValidInput();
    const ctx = buildSessionAnalysisContext({
      ...base,
      session: { ...base.session, patient_reported_mood: null },
    });
    assert.equal("patient_reported_mood" in ctx, false);
  });

  it("rechaza mood no permitido", () => {
    const base = makeValidInput();
    assert.throws(() => buildSessionAnalysisContext({
      ...base,
      session: { ...base.session, patient_reported_mood: "furia" },
    }), TypeError);
  });
});

describe("contextBuilder — patient removido del boundary IA (7G §4)", () => {
  it("ctx.patient no existe aunque el caller pase datos", () => {
    const ctx = buildSessionAnalysisContext(makeValidInput({
      patient: { age: 72, name: "Juan Perez", email: "j@p.com" },
    }));
    assert.equal(ctx.patient, undefined);
    const json = JSON.stringify(ctx);
    assert.ok(!json.includes("Juan"));
    assert.ok(!json.includes("j@p.com"));
    assert.ok(!json.includes("\"age\""));
  });
});
