// 7E: tests del responseValidator — sin Ollama, sin DB.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSessionAnalysisContext } from "../src/services/ai/contextBuilder.js";
import {
  parseAndValidateSessionAnalysis,
  ANALYSIS_LIMITS,
  ANALYSIS_SCHEMA_VERSION,
} from "../src/services/ai/responseValidator.js";
import {
  AnalysisValidationError,
  AnalysisValidationCodes as CODES,
} from "../src/services/ai/validationErrors.js";

// ---- Helpers ----

function metricsRow(overrides = {}) {
  return {
    total_questions: 5, answered_questions: 5,
    correct_count: 4, incorrect_count: 1, unanswered_count: 0,
    accuracy: 0.8, completion_rate: 1,
    mean_latency_ms: 4200, min_latency_ms: 2100, max_latency_ms: 6300,
    latency_std_ms: 1200.5,
    ...overrides,
  };
}

function ctxOneSection() {
  return buildSessionAnalysisContext({
    session: { duration_seconds: 300 },
    patient: { age: 72 },
    global: metricsRow(),
    sections: [
      {
        slug: "atencion_visual",
        name: "Objetos de la casa",
        cognitive_domain_slugs: ["atencion", "memoria"],
        result: metricsRow(),
      },
    ],
  });
}

function ctxTwoSections() {
  return buildSessionAnalysisContext({
    session: { duration_seconds: 600 },
    patient: null,
    global: metricsRow({ accuracy: 0.72, mean_latency_ms: 4200 }),
    sections: [
      {
        slug: "atencion_visual",
        name: "Objetos de la casa",
        cognitive_domain_slugs: ["atencion"],
        result: metricsRow({ accuracy: 0.8, mean_latency_ms: 3800 }),
      },
      {
        slug: "orientacion_espacial",
        name: "Camino al barrio",
        cognitive_domain_slugs: ["orientacion"],
        result: metricsRow({ accuracy: 0.6, mean_latency_ms: 5000, correct_count: 3, incorrect_count: 2 }),
      },
    ],
  });
}

function validPayloadOneSection() {
  return {
    schema_version: "1",
    summary: "Sesión completa. La persona respondió las 5 preguntas.",
    observations_by_section: [
      { section_slug: "atencion_visual", observation: "Respondió las 5 preguntas de la sección." },
    ],
    aspects_to_review: [],
    evidence: [
      { scope: "global", metric: "accuracy", value: 0.8 },
      { scope: "section", metric: "mean_latency_ms", value: 4200, section_slug: "atencion_visual" },
    ],
  };
}

function validPayloadTwoSections() {
  return {
    schema_version: "1",
    summary: "Sesión con dos secciones completadas.",
    observations_by_section: [
      // El contextBuilder ordena sections por slug: atencion_visual antes que orientacion_espacial.
      { section_slug: "atencion_visual", observation: "Respondió sin dejar preguntas sin contestar." },
      { section_slug: "orientacion_espacial", observation: "Completó todas las preguntas." },
    ],
    aspects_to_review: ["Continuar con la misma cadencia semanal."],
    evidence: [
      { scope: "global", metric: "accuracy", value: 0.72 },
      { scope: "section", metric: "accuracy", value: 0.8, section_slug: "atencion_visual" },
      { scope: "section", metric: "accuracy", value: 0.6, section_slug: "orientacion_espacial" },
    ],
  };
}

// ---------- Happy path ----------

describe("responseValidator — happy path", () => {
  it("acepta output válido con 1 sección", () => {
    const ctx = ctxOneSection();
    const out = parseAndValidateSessionAnalysis(JSON.stringify(validPayloadOneSection()), ctx);
    assert.equal(out.schema_version, ANALYSIS_SCHEMA_VERSION);
    assert.equal(out.summary.length > 0, true);
    assert.equal(out.observations_by_section.length, 1);
    assert.deepEqual(out.aspects_to_review, []);
    assert.equal(out.evidence.length, 2);
    assert.ok(Object.isFrozen(out));
  });

  it("acepta output válido con múltiples secciones y aspects", () => {
    const ctx = ctxTwoSections();
    const out = parseAndValidateSessionAnalysis(JSON.stringify(validPayloadTwoSections()), ctx);
    assert.equal(out.observations_by_section.length, 2);
    assert.equal(out.aspects_to_review.length, 1);
    assert.equal(out.evidence.length, 3);
  });

  it("acepta evidence.value=null cuando el contexto tiene null", () => {
    const ctx = buildSessionAnalysisContext({
      global: metricsRow({ accuracy: null, mean_latency_ms: null, min_latency_ms: null, max_latency_ms: null, latency_std_ms: null }),
      sections: [
        {
          slug: "s1", name: "S1", cognitive_domain_slugs: [],
          result: metricsRow({ accuracy: null, mean_latency_ms: null, min_latency_ms: null, max_latency_ms: null, latency_std_ms: null }),
        },
      ],
    });
    const payload = {
      schema_version: "1",
      summary: "sin métricas puntuables.",
      observations_by_section: [{ section_slug: "s1", observation: "no hubo respuestas puntuables." }],
      aspects_to_review: [],
      evidence: [
        { scope: "global", metric: "accuracy", value: null },
        { scope: "section", metric: "mean_latency_ms", value: null, section_slug: "s1" },
      ],
    };
    const out = parseAndValidateSessionAnalysis(JSON.stringify(payload), ctx);
    assert.equal(out.evidence[0].value, null);
  });

  it("acepta evidence sólo global (sin section)", () => {
    const ctx = ctxOneSection();
    const payload = validPayloadOneSection();
    payload.evidence = [
      { scope: "global", metric: "accuracy", value: 0.8 },
      { scope: "global", metric: "completion_rate", value: 1 },
    ];
    const out = parseAndValidateSessionAnalysis(JSON.stringify(payload), ctx);
    assert.equal(out.evidence.length, 2);
  });

  it("acepta evidence sólo por sección", () => {
    const ctx = ctxOneSection();
    const payload = validPayloadOneSection();
    payload.evidence = [
      { scope: "section", metric: "accuracy", value: 0.8, section_slug: "atencion_visual" },
    ];
    const out = parseAndValidateSessionAnalysis(JSON.stringify(payload), ctx);
    assert.equal(out.evidence.length, 1);
  });

  it("acepta pequeña tolerancia numérica (0.7999999 ≈ 0.8)", () => {
    const ctx = ctxOneSection();
    const payload = validPayloadOneSection();
    payload.evidence = [{ scope: "global", metric: "accuracy", value: 0.7999999999 }];
    const out = parseAndValidateSessionAnalysis(JSON.stringify(payload), ctx);
    assert.equal(out.evidence[0].value, 0.7999999999);
  });
});

// ---------- JSON parsing ----------

describe("responseValidator — JSON parsing", () => {
  it("rechaza rawText no string", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis(null, ctxOneSection()),
      (e) => e instanceof AnalysisValidationError && e.code === CODES.INVALID_JSON
    );
  });

  it("rechaza JSON malformado", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis("{oops", ctxOneSection()),
      (e) => e.code === CODES.INVALID_JSON
    );
  });

  it("rechaza root no-objeto", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis("[1,2,3]", ctxOneSection()),
      (e) => e.code === CODES.SCHEMA_INVALID && e.message.includes("root")
    );
    assert.throws(
      () => parseAndValidateSessionAnalysis("42", ctxOneSection()),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
    assert.throws(
      () => parseAndValidateSessionAnalysis("null", ctxOneSection()),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });

  it("valida context en tiempo de dev (TypeError si mal)", () => {
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(validPayloadOneSection()), null),
      TypeError
    );
  });
});

// ---------- schema_version ----------

describe("responseValidator — schema_version", () => {
  it("rechaza schema_version distinto de '1'", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection(); p.schema_version = "2";
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID && e.path === "schema_version"
    );
  });

  it("rechaza schema_version faltante", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection(); delete p.schema_version;
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });
});

// ---------- Strict mode ----------

describe("responseValidator — strict mode (§4)", () => {
  it("rechaza campo extra en root: confidence", () => {
    const ctx = ctxOneSection();
    const p = { ...validPayloadOneSection(), confidence: "high" };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.UNEXPECTED_FIELD
    );
  });

  it("rechaza campo extra en root: diagnosis", () => {
    const ctx = ctxOneSection();
    const p = { ...validPayloadOneSection(), diagnosis: "..." };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.UNEXPECTED_FIELD
    );
  });

  it("rechaza campo extra dentro de una observation", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.observations_by_section[0].score = 0.8;
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.UNEXPECTED_FIELD
    );
  });

  it("rechaza campo extra en evidence global", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "accuracy", value: 0.8, note: "x" }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });
});

// ---------- observations_by_section ----------

describe("responseValidator — observations_by_section", () => {
  it("rechaza sección desconocida", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.observations_by_section = [{ section_slug: "inexistente", observation: "x" }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SECTIONS_MISMATCH
    );
  });

  it("rechaza sección duplicada", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.observations_by_section = [
      { section_slug: "atencion_visual", observation: "a" },
      { section_slug: "atencion_visual", observation: "b" },
    ];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SECTIONS_MISMATCH
    );
  });

  it("rechaza sección faltante", () => {
    const ctx = ctxTwoSections();
    const p = validPayloadTwoSections();
    p.observations_by_section = [p.observations_by_section[0]];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SECTIONS_MISMATCH
    );
  });

  it("rechaza orden incorrecto de secciones", () => {
    const ctx = ctxTwoSections();
    const p = validPayloadTwoSections();
    p.observations_by_section = [
      { section_slug: "orientacion_espacial", observation: "x" },
      { section_slug: "atencion_visual", observation: "y" },
    ];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SECTIONS_MISMATCH
    );
  });

  it("rechaza observation vacía", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.observations_by_section[0].observation = "";
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });

  it("rechaza observation demasiado larga", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.observations_by_section[0].observation = "x".repeat(ANALYSIS_LIMITS.observationMax + 1);
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });
});

// ---------- summary + aspects ----------

describe("responseValidator — summary + aspects", () => {
  it("rechaza summary vacío o >400", () => {
    const ctx = ctxOneSection();
    const bad1 = { ...validPayloadOneSection(), summary: "" };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(bad1), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
    const bad2 = { ...validPayloadOneSection(), summary: "x".repeat(ANALYSIS_LIMITS.summaryMax + 1) };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(bad2), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });

  it("rechaza aspect vacío o demasiado largo", () => {
    const ctx = ctxOneSection();
    const bad1 = { ...validPayloadOneSection(), aspects_to_review: [""] };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(bad1), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
    const bad2 = {
      ...validPayloadOneSection(),
      aspects_to_review: ["x".repeat(ANALYSIS_LIMITS.aspectMax + 1)],
    };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(bad2), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });

  it("rechaza demasiados aspects", () => {
    const ctx = ctxOneSection();
    const p = {
      ...validPayloadOneSection(),
      aspects_to_review: Array(ANALYSIS_LIMITS.aspectsCountMax + 1).fill("ok"),
    };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });

  it("rechaza aspects_to_review no array", () => {
    const ctx = ctxOneSection();
    const p = { ...validPayloadOneSection(), aspects_to_review: "no" };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });
});

// ---------- evidence ----------

describe("responseValidator — evidence", () => {
  it("rechaza metric desconocida", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "iq", value: 100 }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza scope inválido", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "patient", metric: "accuracy", value: 0.8 }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza section desconocida en evidence", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "section", metric: "accuracy", value: 0.8, section_slug: "no_existe" }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza value que no coincide con el contexto", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "accuracy", value: 0.99 }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza value inventado cuando el contexto es null", () => {
    const ctx = buildSessionAnalysisContext({
      global: metricsRow({ accuracy: null }),
      sections: [{ slug: "s1", name: "S1", cognitive_domain_slugs: [], result: metricsRow() }],
    });
    const p = {
      schema_version: "1", summary: "s",
      observations_by_section: [{ section_slug: "s1", observation: "x" }],
      aspects_to_review: [],
      evidence: [{ scope: "global", metric: "accuracy", value: 0.5 }],
    };
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza null cuando el contexto tiene un número", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "accuracy", value: null }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza global con section_slug presente", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "accuracy", value: 0.8, section_slug: "atencion_visual" }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza section sin section_slug", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "section", metric: "accuracy", value: 0.8 }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza NaN e Infinity", () => {
    const ctx = ctxOneSection();
    // JSON.stringify(NaN) === "null", así que probamos con string crudo.
    const raw = `{"schema_version":"1","summary":"s","observations_by_section":[{"section_slug":"atencion_visual","observation":"x"}],"aspects_to_review":[],"evidence":[{"scope":"global","metric":"accuracy","value":NaN}]}`;
    assert.throws(
      () => parseAndValidateSessionAnalysis(raw, ctx),
      (e) => e.code === CODES.INVALID_JSON
    );
    // Un número inválido para el contexto: value real es 0.8, pasamos 0.
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "accuracy", value: 0 }];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("rechaza evidence excesivo (>evidenceCountMax)", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = Array(ANALYSIS_LIMITS.evidenceCountMax + 1).fill({
      scope: "global", metric: "accuracy", value: 0.8,
    });
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.SCHEMA_INVALID
    );
  });

  it("rechaza evidence=[] (mínimo 1 elemento — ajuste previo a 7F)", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [];
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });

  it("acepta evidence con exactamente 1 elemento", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "accuracy", value: 0.8 }];
    const out = parseAndValidateSessionAnalysis(JSON.stringify(p), ctx);
    assert.equal(out.evidence.length, 1);
  });
});

// ---------- Regresión 7B (documentada) ----------

describe("responseValidator — regresión 7B (limitación documentada)", () => {
  it("un summary con frase evaluativa PASA estructuralmente si el evidence no la respalda con datos falsos", () => {
    // Ver §10: no montamos un detector clínico ingenuo en v1.
    // El validador NO rechaza esta salida — es una limitación aceptada.
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.summary = "La respuesta fue rápida y el desempeño se ve prometedor.";
    const out = parseAndValidateSessionAnalysis(JSON.stringify(p), ctx);
    assert.equal(out.summary.length > 0, true);
  });

  it("pero evidence con value inventado sí es rechazado (esto es lo que sí bloqueamos)", () => {
    const ctx = ctxOneSection();
    const p = validPayloadOneSection();
    p.evidence = [{ scope: "global", metric: "mean_latency_ms", value: 100 }]; // real: 4200
    assert.throws(
      () => parseAndValidateSessionAnalysis(JSON.stringify(p), ctx),
      (e) => e.code === CODES.EVIDENCE_INVALID
    );
  });
});
