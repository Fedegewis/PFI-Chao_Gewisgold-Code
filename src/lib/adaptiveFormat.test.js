import { describe, expect, test } from "vitest";
import { formatAdaptiveLevel, formatAdaptiveSummary } from "./adaptiveFormat.js";
import { formatComparisonMetrics } from "./analysisFormat.js";

const THRESHOLDS = { up: 0.8, down: 0.4, min_sessions: 2, min_scored_responses: 6, max_lookback_sessions: 4 };

function adaptive(decision, level = decision.level) {
  return { level, version: "1", decision: { thresholds: THRESHOLDS, ...decision } };
}

const CLINICAL = /deterioro|d[eé]ficit|diagn[oó]stic|trastorno|patolog|capacidad/i;

describe("formatAdaptiveSummary", () => {
  test("sin nivel (sesión histórica) → null", () => {
    expect(formatAdaptiveSummary(null)).toBeNull();
    expect(formatAdaptiveSummary({ level: null })).toBeNull();
  });

  test("nivel inicial", () => {
    const s = formatAdaptiveSummary(adaptive({
      level: 2, previous_level: null, change: "initial", rule: "initial_level",
      evidence: { session_ids: [], sessions_count: 0, correct_count: 0, scored_count: 0, accuracy: null },
      selection: { targets: { 1: 1, 2: 2, 3: 1 }, actual_mix: { 1: 1, 2: 2, 3: 1 } },
    }));
    expect(s.level).toBe("Nivel 2 (intermedio)");
    expect(s.change).toBe("Nivel inicial");
    expect(s.evidence).toBe("Sin sesiones completadas previas en este nivel.");
    expect(s.mix).toBe("Fácil: 1 · Media: 2 · Difícil: 1");
    expect(s.usedFallback).toBe(false);
  });

  test("subida con evidencia y umbral", () => {
    const s = formatAdaptiveSummary(adaptive({
      level: 3, previous_level: 2, change: "up", rule: "high_accuracy_sustained",
      evidence: { session_ids: [5, 4], sessions_count: 2, correct_count: 7, scored_count: 8, accuracy: 0.875 },
      selection: { targets: { 1: 0, 2: 1, 3: 3 }, actual_mix: { 1: 0, 2: 1, 3: 3 } },
    }));
    expect(s.change).toBe("Subió (antes: nivel 2)");
    expect(s.reason).toContain("80 %");
    expect(s.evidence).toBe("2 sesiones · 7 de 8 respuestas correctas (87,5 %)");
    expect(s.mix).toBe("Media: 1 · Difícil: 3");
  });

  test("bajada, mantenimiento y evidencia insuficiente", () => {
    expect(formatAdaptiveSummary(adaptive({ level: 1, previous_level: 2, change: "down", rule: "low_accuracy_sustained" })).change)
      .toBe("Bajó (antes: nivel 2)");
    const hold = formatAdaptiveSummary(adaptive({ level: 2, previous_level: 2, change: "hold", rule: "insufficient_evidence" }));
    expect(hold.change).toBe("Se mantuvo en nivel 2");
    expect(hold.reason).toContain("al menos 2 sesiones completadas y 6 respuestas");
  });

  test("marca el uso de fallback cuando la mezcla real difiere del objetivo", () => {
    const s = formatAdaptiveSummary(adaptive({
      level: 2, change: "hold", rule: "intermediate_accuracy",
      selection: { targets: { 1: 1, 2: 2, 3: 1 }, actual_mix: { 1: 1, 2: 3, 3: 0 } },
    }));
    expect(s.usedFallback).toBe(true);
    expect(s.target).toBe("Fácil: 1 · Media: 2 · Difícil: 1");
  });

  test("ningún texto usa términos clínicos", () => {
    const rules = ["initial_level", "insufficient_evidence", "high_accuracy_sustained", "low_accuracy_sustained", "intermediate_accuracy", "max_level_reached", "min_level_reached"];
    for (const rule of rules) {
      const s = formatAdaptiveSummary(adaptive({ level: 2, previous_level: 2, change: "hold", rule }));
      expect(`${s.level} ${s.change} ${s.reason} ${s.evidence}`).not.toMatch(CLINICAL);
    }
    expect(formatAdaptiveLevel(9)).toBe("—");
  });
});

describe("formatComparisonMetrics — nivel de dificultad (P1)", () => {
  const base = {
    accuracy: { current: 0.5, previous: 0.75, delta_percentage_points: -25, direction: "bajó" },
  };

  test("sin difficulty_level: sin fila de nivel y dirección original", () => {
    const rows = formatComparisonMetrics(base);
    expect(rows.map((r) => r.metric)).toEqual(["accuracy"]);
    expect(rows[0].text).toContain("(bajó)");
  });

  test("mismo nivel: fila informativa y dirección original", () => {
    const rows = formatComparisonMetrics({ ...base, difficulty_level: { current: 2, previous: 2, same: true } });
    expect(rows[0].metric).toBe("difficulty_level");
    expect(rows[0].text).toContain("mismo nivel");
    expect(rows[1].text).toContain("(bajó)");
  });

  test("distinto nivel: aclara y no describe la precisión como subida o bajada", () => {
    const rows = formatComparisonMetrics({ ...base, difficulty_level: { current: 3, previous: 2, same: false } });
    expect(rows[0].text).toBe("Actual nivel 3, anterior nivel 2. Las sesiones tienen distinto nivel de dificultad: la variación de precisión no es directamente comparable.");
    expect(rows[1].text).toContain("(no directamente comparable)");
    expect(rows[1].text).not.toContain("(bajó)");
  });

  test("nivel desconocido en una sesión", () => {
    const rows = formatComparisonMetrics({ ...base, difficulty_level: { current: 2, previous: null, same: null } });
    expect(rows[0].text).toContain("sin nivel registrado");
    expect(rows[1].text).toContain("(no directamente comparable)");
  });
});
