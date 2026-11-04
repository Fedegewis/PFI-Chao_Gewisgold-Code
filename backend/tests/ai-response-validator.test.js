// Tests del responseValidator — schema v3.
//
// Cubren: happy path, JSON inválido, campos adicionales rechazados, tipos,
// límites, aspects_to_review opcional, términos clínicos y métricas numéricas
// bloqueadas en el texto generado por el modelo.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseAndValidateSessionAnalysis,
  ANALYSIS_SCHEMA_VERSION,
  ANALYSIS_LIMITS,
} from "../src/services/ai/responseValidator.js";
import { AnalysisValidationCodes as CODES } from "../src/services/ai/validationErrors.js";

function metrics() {
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
  };
}

function ctx(extra = {}) {
  return Object.freeze({
    schema_version: "2",
    language: "es",
    duration_seconds: 21,
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

function valid() {
  return {
    schema_version: "3",
    summary: "Síntesis breve descriptiva de la sesión trabajada.",
    aspects_to_review: ["Revisar continuidad del foco durante la actividad."],
  };
}

const raw = (p) => JSON.stringify(p);

describe("responseValidator v3 — happy path", () => {
  it("acepta payload mínimo: schema_version + summary", () => {
    const out = parseAndValidateSessionAnalysis(
      raw({ schema_version: "3", summary: "Síntesis breve." }),
      ctx()
    );
    assert.equal(out.schema_version, ANALYSIS_SCHEMA_VERSION);
    assert.equal(out.summary, "Síntesis breve.");
    assert.deepEqual(out.aspects_to_review, []);
  });

  it("acepta aspects_to_review array no vacío", () => {
    const out = parseAndValidateSessionAnalysis(raw(valid()), ctx());
    assert.equal(out.aspects_to_review.length, 1);
  });

  it("acepta aspects_to_review ausente", () => {
    const p = { schema_version: "3", summary: "Síntesis." };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.deepEqual(out.aspects_to_review, []);
  });

  it("acepta aspects_to_review null (lo normaliza a [])", () => {
    const p = { schema_version: "3", summary: "s.", aspects_to_review: null };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.deepEqual(out.aspects_to_review, []);
  });

  it("ANALYSIS_SCHEMA_VERSION exportado es '3'", () => {
    assert.equal(ANALYSIS_SCHEMA_VERSION, "3");
  });
});

describe("responseValidator v3 — JSON y estructura inválidos", () => {
  it("INVALID_JSON si el string no parsea", () => {
    try {
      parseAndValidateSessionAnalysis("no es json {", ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.INVALID_JSON);
    }
  });

  it("SCHEMA_INVALID si el root es un array", () => {
    try {
      parseAndValidateSessionAnalysis("[]", ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
    }
  });

  it("UNEXPECTED_FIELD si trae observations_by_section (campo v2)", () => {
    const p = { ...valid(), observations_by_section: [] };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.UNEXPECTED_FIELD);
    }
  });

  it("UNEXPECTED_FIELD si trae comparison (campo v2)", () => {
    const p = { ...valid(), comparison: "cambio" };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.UNEXPECTED_FIELD);
    }
  });

  it("UNEXPECTED_FIELD si trae evidence (debe generarla backend)", () => {
    const p = { ...valid(), evidence: [] };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.UNEXPECTED_FIELD);
    }
  });

  it("UNEXPECTED_FIELD si trae cualquier campo desconocido", () => {
    const p = { ...valid(), diagnosis: "" };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.UNEXPECTED_FIELD);
    }
  });

  it("SCHEMA_INVALID si schema_version != '3'", () => {
    const p = { ...valid(), schema_version: "2" };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
      assert.equal(err.path, "schema_version");
    }
  });

  it("SCHEMA_INVALID si falta summary", () => {
    const p = { schema_version: "3" };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
      assert.equal(err.path, "summary");
    }
  });

  it("SCHEMA_INVALID si summary vacío", () => {
    const p = { schema_version: "3", summary: "" };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
    }
  });
});

describe("responseValidator v3 — límites", () => {
  it("acepta summary de 600 chars (longitud histórica)", () => {
    const p = { schema_version: "3", summary: "x".repeat(600) };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.equal(out.summary.length, 600);
  });

  it("acepta summary de 735 chars (longitud observada del 3B)", () => {
    const p = { schema_version: "3", summary: "x".repeat(735) };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.equal(out.summary.length, 735);
  });

  it("acepta summary de 1000 chars (justo en el techo)", () => {
    const p = { schema_version: "3", summary: "x".repeat(1000) };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.equal(out.summary.length, 1000);
  });

  it("SCHEMA_INVALID + max_length_exceeded si summary = 1001 chars", () => {
    const p = { schema_version: "3", summary: "x".repeat(1001) };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
      assert.equal(err.path, "summary");
      assert.equal(err.info?.reason, "max_length_exceeded");
      assert.equal(err.info?.max, 1000);
      assert.equal(err.info?.actual, 1001);
    }
  });

  it("SCHEMA_INVALID + max_length_exceeded si summary > 1000 chars", () => {
    const p = { schema_version: "3", summary: "x".repeat(1100) };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
      assert.equal(err.path, "summary");
      assert.equal(err.info?.reason, "max_length_exceeded");
    }
  });

  it("SCHEMA_INVALID si aspects_to_review > 5 ítems", () => {
    const p = {
      ...valid(),
      aspects_to_review: ["a", "b", "c", "d", "e", "f"],
    };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
      assert.equal(err.path, "aspects_to_review");
    }
  });

  it("SCHEMA_INVALID si un aspecto excede 180 chars", () => {
    const p = { ...valid(), aspects_to_review: ["x".repeat(181)] };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.code, CODES.SCHEMA_INVALID);
    }
  });

  it("ANALYSIS_LIMITS expone los límites v3", () => {
    assert.equal(ANALYSIS_LIMITS.summaryMax, 1000);
    assert.equal(ANALYSIS_LIMITS.aspectMax, 180);
    assert.equal(ANALYSIS_LIMITS.aspectsCountMax, 5);
  });
});

describe("responseValidator v3 — términos clínicos prohibidos", () => {
  // Desde la auditoría 2026-11-04 cada familia informa su propia reason:
  // los términos clínicos siguen siendo forbidden_clinical_term y las
  // calificaciones subjetivas pasan a evaluative_judgment.
  const forbidden = [
    ["Se observa déficit de atención en la sesión.", "forbidden_clinical_term"],
    ["El paciente presenta deterioro cognitivo evidente.", "forbidden_clinical_term"],
    ["Alto nivel de precisión durante la actividad.", "evaluative_judgment"],
    ["Excelente desempeño en la sesión trabajada.", "evaluative_judgment"],
    ["Mala memoria durante el ejercicio planteado.", "evaluative_judgment"],
    ["Nivel adecuado de respuesta durante la actividad.", "evaluative_judgment"],
  ];
  for (const [s, reason] of forbidden) {
    it(`rechaza summary con término clínico/evaluativo: "${s.slice(0, 40)}…"`, () => {
      const p = { schema_version: "3", summary: s };
      try {
        parseAndValidateSessionAnalysis(raw(p), ctx());
        assert.fail("debió lanzar");
      } catch (err) {
        assert.equal(err.code, CODES.SCHEMA_INVALID);
        assert.equal(err.info?.reason, reason);
      }
    });
  }

  it("también revisa aspects_to_review", () => {
    const p = {
      schema_version: "3",
      summary: "Síntesis breve.",
      aspects_to_review: ["Revisar el déficit cognitivo observado."],
    };
    try {
      parseAndValidateSessionAnalysis(raw(p), ctx());
      assert.fail("debió lanzar");
    } catch (err) {
      assert.equal(err.info?.reason, "forbidden_clinical_term");
    }
  });

  it("acepta términos descriptivos legítimos (memoria, atención, actividad)", () => {
    const p = {
      schema_version: "3",
      summary: "La actividad trabajada apuntó a la atención y la memoria durante la sesión.",
    };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.ok(out.summary);
  });
});

describe("responseValidator v3 — métricas numéricas en el texto", () => {
  const numeric = [
    "La paciente mostró 50% de precisión.",
    "Respondió 5/8 preguntas correctamente.",
    "Hubo 3 aciertos en la sesión.",
    "Completó 4 preguntas durante la actividad.",
    "La actividad duró 32 segundos.",
    "El tiempo medio fue de 820 ms.",
    "Logró 50 por ciento de completitud.",
    "Latencia media de 2.3 s durante la actividad.",
  ];
  for (const s of numeric) {
    it(`rechaza summary con métrica numérica: "${s.slice(0, 40)}…"`, () => {
      const p = { schema_version: "3", summary: s };
      try {
        parseAndValidateSessionAnalysis(raw(p), ctx());
        assert.fail("debió lanzar");
      } catch (err) {
        assert.equal(err.code, CODES.SCHEMA_INVALID);
        assert.equal(err.info?.reason, "numeric_metric_in_text");
      }
    });
  }

  it("acepta frases legítimas sin cifras", () => {
    const p = {
      schema_version: "3",
      summary: "Se trabajó una sola actividad durante la sesión.",
    };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.ok(out.summary);
  });
});

describe("responseValidator v3.4 — atribución al profesional / paciente", () => {
  const forbidden = [
    "El profesional observó que el paciente retuvo la lista.",
    "El profesional afirmó que la sesión fue adecuada.",
    "La profesional concluyó que la actividad fue útil.",
    "El paciente mostró una buena disposición para la actividad.",
  ];
  for (const s of forbidden) {
    it(`rechaza summary con atribución al profesional/paciente: "${s.slice(0, 40)}…"`, () => {
      const p = { schema_version: "3", summary: s };
      try {
        parseAndValidateSessionAnalysis(raw(p), ctx());
        assert.fail("debió lanzar");
      } catch (err) {
        assert.equal(err.code, CODES.SCHEMA_INVALID);
        assert.equal(err.info?.reason, "unauthorized_observation_about_actor");
      }
    });
  }

  it("acepta frases legítimas sin atribución", () => {
    const p = {
      schema_version: "3",
      summary: "Durante la actividad se trabajó la lista del supermercado.",
    };
    const out = parseAndValidateSessionAnalysis(raw(p), ctx());
    assert.ok(out.summary);
  });
});

describe("responseValidator v3 — salida congelada", () => {
  it("el objeto devuelto está congelado y no incluye campos sobrantes", () => {
    const out = parseAndValidateSessionAnalysis(raw(valid()), ctx());
    assert.equal(Object.isFrozen(out), true);
    assert.deepEqual(Object.keys(out).sort(), ["aspects_to_review", "schema_version", "summary"]);
  });
});
