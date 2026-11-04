// Tests unitarios del servicio puro adaptiveDifficulty.js (sin DB).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTIVE_CONFIG,
  ADAPTIVE_VERSION,
  buildDifficultyTargets,
  computeAdaptiveLevel,
  selectByDifficulty,
} from "../src/services/adaptiveDifficulty.js";

// rng determinístico (mulberry32) para reproducir selecciones.
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1000;
// Sesión del historial (más reciente primero en los arrays de los tests).
function s(level, correct, total, status = "completed") {
  nextId += 1;
  const done = status === "completed";
  return {
    session_id: nextId,
    status,
    adaptive_level: level,
    correct_count: done ? correct : null,
    incorrect_count: done ? total - correct : null,
  };
}

describe("computeAdaptiveLevel", () => {
  it("paciente nuevo (sin historial) → nivel inicial 2", () => {
    const d = computeAdaptiveLevel([]);
    assert.equal(d.level, 2);
    assert.equal(d.change, "initial");
    assert.equal(d.rule, "initial_level");
    assert.equal(d.previous_level, null);
    assert.equal(d.version, ADAPTIVE_VERSION);
    assert.deepEqual(d.evidence.session_ids, []);
  });

  it("historial sólo con sesiones sin nivel (históricas) → nivel inicial", () => {
    const d = computeAdaptiveLevel([s(null, 4, 4), s(null, 4, 4), s(null, 0, 4)]);
    assert.equal(d.level, 2);
    assert.equal(d.rule, "initial_level");
  });

  it("alto desempeño sostenido (7/8) → sube un nivel", () => {
    const h = [s(2, 4, 4), s(2, 3, 4)];
    const d = computeAdaptiveLevel(h);
    assert.equal(d.level, 3);
    assert.equal(d.change, "up");
    assert.equal(d.rule, "high_accuracy_sustained");
    assert.deepEqual(d.evidence.session_ids, h.map((x) => x.session_id));
    assert.equal(d.evidence.correct_count, 7);
    assert.equal(d.evidence.scored_count, 8);
    assert.equal(d.evidence.accuracy, 0.875);
  });

  it("bajo desempeño sostenido (3/8) → baja un nivel", () => {
    const d = computeAdaptiveLevel([s(2, 1, 4), s(2, 2, 4)]);
    assert.equal(d.level, 1);
    assert.equal(d.change, "down");
    assert.equal(d.rule, "low_accuracy_sustained");
  });

  it("rendimiento mixto (5/8) → se mantiene", () => {
    const d = computeAdaptiveLevel([s(2, 2, 4), s(2, 3, 4)]);
    assert.equal(d.level, 2);
    assert.equal(d.change, "hold");
    assert.equal(d.rule, "intermediate_accuracy");
  });

  it("los umbrales son inclusivos: 0,80 sube y 0,40 baja; 0,50 se mantiene", () => {
    assert.equal(computeAdaptiveLevel([s(2, 4, 5), s(2, 4, 5)]).change, "up");
    assert.equal(computeAdaptiveLevel([s(2, 2, 5), s(2, 2, 5)]).change, "down");
    assert.equal(computeAdaptiveLevel([s(2, 3, 6), s(2, 3, 6)]).change, "hold");
  });

  it("evidencia insuficiente: una sola sesión completa, aunque sea perfecta", () => {
    const d = computeAdaptiveLevel([s(2, 10, 10)]);
    assert.equal(d.level, 2);
    assert.equal(d.rule, "insufficient_evidence");
    assert.equal(d.evidence.sessions_count, 1);
  });

  it("evidencia insuficiente: dos sesiones con menos de 6 respuestas puntuadas", () => {
    const d = computeAdaptiveLevel([s(2, 2, 2), s(2, 2, 2)]);
    assert.equal(d.rule, "insufficient_evidence");
  });

  it("con sesiones cortas acumula hasta reunir 6 respuestas (3 sesiones de 2)", () => {
    const d = computeAdaptiveLevel([s(2, 2, 2), s(2, 2, 2), s(2, 2, 2), s(2, 0, 2)]);
    assert.equal(d.change, "up");
    assert.equal(d.evidence.sessions_count, 3);
  });

  it("examina como máximo 4 sesiones completas", () => {
    const d = computeAdaptiveLevel([s(2, 1, 1), s(2, 1, 1), s(2, 1, 1), s(2, 1, 1), s(2, 1, 1), s(2, 1, 1)]);
    assert.equal(d.rule, "insufficient_evidence");
    assert.equal(d.evidence.sessions_count, 4);
  });

  it("usa sólo las sesiones más recientes necesarias (no arrastra resultados viejos)", () => {
    const d = computeAdaptiveLevel([s(2, 4, 4), s(2, 4, 4), s(2, 0, 4), s(2, 0, 4)]);
    assert.equal(d.change, "up");
    assert.equal(d.evidence.sessions_count, 2);
  });

  it("cambio máximo de un nivel aun con precisión perfecta", () => {
    const d = computeAdaptiveLevel([s(1, 10, 10), s(1, 10, 10), s(1, 10, 10)]);
    assert.equal(d.level, 2);
  });

  it("topes: en nivel 3 con alta precisión se mantiene; en nivel 1 con baja precisión se mantiene", () => {
    const top = computeAdaptiveLevel([s(3, 4, 4), s(3, 4, 4)]);
    assert.equal(top.level, 3);
    assert.equal(top.rule, "max_level_reached");
    const bottom = computeAdaptiveLevel([s(1, 0, 4), s(1, 0, 4)]);
    assert.equal(bottom.level, 1);
    assert.equal(bottom.rule, "min_level_reached");
  });

  it("la ventana se reinicia tras un cambio: sesiones del nivel anterior no cuentan", () => {
    // La más reciente ya está en nivel 3 (después de subir); las de nivel 2 no aportan.
    const d = computeAdaptiveLevel([s(3, 4, 4), s(2, 4, 4), s(2, 4, 4)]);
    assert.equal(d.level, 3);
    assert.equal(d.rule, "insufficient_evidence");
    assert.equal(d.evidence.sessions_count, 1);
  });

  it("sin evidencia nueva no repite el cambio: una sesión creada tras subir fija el nuevo nivel", () => {
    // Se subió a 3 y la sesión de nivel 3 todavía no se completó (o se abandonó).
    for (const status of ["created", "in_progress", "abandoned"]) {
      const d = computeAdaptiveLevel([s(3, 0, 4, status), s(2, 4, 4), s(2, 4, 4)]);
      assert.equal(d.level, 3, status);
      assert.equal(d.rule, "insufficient_evidence", status);
    }
  });

  it("las sesiones abandonadas no aportan evidencia ni cortan la ventana del mismo nivel", () => {
    const d = computeAdaptiveLevel([s(2, 0, 4, "abandoned"), s(2, 4, 4), s(2, 0, 4, "abandoned"), s(2, 4, 4)]);
    assert.equal(d.change, "up");
    assert.equal(d.evidence.sessions_count, 2);
  });

  it("sesiones históricas sin nivel intercaladas se ignoran", () => {
    const d = computeAdaptiveLevel([s(2, 4, 4), s(null, 0, 4), s(2, 4, 4)]);
    assert.equal(d.change, "up");
  });

  it("no oscila: subir y luego bajar requiere evidencia nueva en cada nivel", () => {
    const afterUp = [s(3, 0, 4), s(2, 4, 4), s(2, 4, 4)];
    assert.equal(computeAdaptiveLevel(afterUp).level, 3);
    const twoLowAtThree = [s(3, 0, 4), s(3, 1, 4), s(2, 4, 4), s(2, 4, 4)];
    assert.equal(computeAdaptiveLevel(twoLowAtThree).level, 2);
  });

  it("acepta configuración inyectada", () => {
    const cfg = { ...ADAPTIVE_CONFIG, initialLevel: 1, upThreshold: 0.6 };
    assert.equal(computeAdaptiveLevel([], cfg).level, 1);
    assert.equal(computeAdaptiveLevel([s(1, 5, 8), s(1, 0, 0)], cfg).rule, "insufficient_evidence");
    assert.equal(computeAdaptiveLevel([s(1, 3, 4), s(1, 2, 4)], cfg).change, "up");
  });

  it("es determinístico y la decisión es serializable", () => {
    const h = [s(2, 3, 4), s(2, 4, 4)];
    const a = computeAdaptiveLevel(h);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), computeAdaptiveLevel(h));
    assert.deepEqual(a.thresholds, {
      up: 0.8, down: 0.4, min_sessions: 2, min_scored_responses: 6, max_lookback_sessions: 4,
    });
  });
});

describe("buildDifficultyTargets", () => {
  it("mezclas con 4 preguntas", () => {
    assert.deepEqual(buildDifficultyTargets(1, 4), { 1: 3, 2: 1, 3: 0 });
    assert.deepEqual(buildDifficultyTargets(2, 4), { 1: 1, 2: 2, 3: 1 });
    assert.deepEqual(buildDifficultyTargets(3, 4), { 1: 0, 2: 1, 3: 3 });
  });

  it("reparto determinístico para 1..10 preguntas (suma exacta, sin dificultades fuera de la mezcla)", () => {
    const expected = {
      1: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [3, 1, 0], [4, 1, 0], [5, 1, 0], [5, 2, 0], [6, 2, 0], [7, 2, 0], [8, 2, 0]],
      2: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [1, 2, 1], [1, 3, 1], [2, 3, 1], [2, 3, 2], [2, 4, 2], [2, 5, 2], [3, 5, 2]],
      3: [[0, 0, 1], [0, 0, 2], [0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 1, 5], [0, 2, 5], [0, 2, 6], [0, 2, 7], [0, 2, 8]],
    };
    for (const level of [1, 2, 3]) {
      for (let n = 1; n <= 10; n += 1) {
        const t = buildDifficultyTargets(level, n);
        assert.equal(t[1] + t[2] + t[3], n);
        assert.deepEqual([t[1], t[2], t[3]], expected[level][n - 1], `nivel ${level}, n=${n}`);
      }
    }
  });

  it("rechaza nivel o cantidad inválidos", () => {
    assert.throws(() => buildDifficultyTargets(4, 4), RangeError);
    assert.throws(() => buildDifficultyTargets(2, -1), RangeError);
  });
});

function bank({ d1 = 0, d2 = 0, d3 = 0, unknown = 0 }) {
  const out = [];
  let id = 1;
  for (const [difficulty, n] of [[1, d1], [2, d2], [3, d3], [null, unknown]]) {
    for (let i = 0; i < n; i += 1) out.push({ id: id++, difficulty });
  }
  return out;
}

function mixOf(questions) {
  const m = { 1: 0, 2: 0, 3: 0 };
  for (const q of questions) m[q.difficulty] += 1;
  return m;
}

describe("selectByDifficulty", () => {
  it("respeta la mezcla objetivo cuando hay preguntas suficientes", () => {
    const r = selectByDifficulty(bank({ d1: 10, d2: 10, d3: 10 }), new Set(), { 1: 1, 2: 2, 3: 1 }, 2, seededRng(1));
    assert.equal(r.questions.length, 4);
    assert.deepEqual(mixOf(r.questions), { 1: 1, 2: 2, 3: 1 });
    assert.deepEqual(r.actual_mix, { 1: 1, 2: 2, 3: 1 });
    assert.equal(r.fallback_count, 0);
    assert.equal(r.recent_count, 0);
  });

  it("prefiere preguntas no recientes", () => {
    const eligible = bank({ d1: 4, d2: 4, d3: 4 });
    const recent = new Set(eligible.filter((q) => q.id % 2 === 0).map((q) => q.id));
    const r = selectByDifficulty(eligible, recent, { 1: 1, 2: 2, 3: 1 }, 2, seededRng(2));
    assert.ok(r.questions.every((q) => !recent.has(q.id)));
  });

  it("fallback: sin difíciles usa la dificultad más cercana (media) y no duplica", () => {
    const r = selectByDifficulty(bank({ d1: 5, d2: 5, d3: 0 }), new Set(), { 1: 0, 2: 1, 3: 3 }, 3, seededRng(3));
    assert.equal(r.questions.length, 4);
    assert.deepEqual(r.actual_mix, { 1: 0, 2: 4, 3: 0 });
    assert.equal(r.fallback_count, 3);
    assert.equal(new Set(r.questions.map((q) => q.id)).size, 4);
  });

  it("fallback: ante empate de distancia prioriza la dificultad más cercana al nivel", () => {
    // Faltan medias en nivel 3: la difícil (más cercana al nivel 3) gana a la fácil.
    const r = selectByDifficulty(bank({ d1: 5, d2: 0, d3: 5 }), new Set(), { 1: 0, 2: 1, 3: 3 }, 3, seededRng(4));
    assert.deepEqual(r.actual_mix, { 1: 0, 2: 0, 3: 4 });
    // En nivel 1 la fácil gana.
    const r1 = selectByDifficulty(bank({ d1: 5, d2: 0, d3: 5 }), new Set(), { 1: 3, 2: 1, 3: 0 }, 1, seededRng(4));
    assert.deepEqual(r1.actual_mix, { 1: 4, 2: 0, 3: 0 });
  });

  it("fallback: no recientes de dificultad cercana antes que recientes de la dificultad objetivo", () => {
    const eligible = bank({ d1: 0, d2: 3, d3: 3 });
    const recent = new Set(eligible.filter((q) => q.difficulty === 3).map((q) => q.id));
    const r = selectByDifficulty(eligible, recent, { 1: 0, 2: 1, 3: 2 }, 3, seededRng(5));
    assert.deepEqual(r.actual_mix, { 1: 0, 2: 3, 3: 0 });
    assert.equal(r.recent_count, 0);
  });

  it("fallback: recurre a recientes cuando no quedan no recientes", () => {
    const eligible = bank({ d1: 1, d2: 2, d3: 1 });
    const recent = new Set(eligible.map((q) => q.id));
    const r = selectByDifficulty(eligible, recent, { 1: 1, 2: 2, 3: 1 }, 2, seededRng(6));
    assert.equal(r.questions.length, 4);
    assert.equal(r.recent_count, 4);
    assert.deepEqual(r.actual_mix, { 1: 1, 2: 2, 3: 1 });
  });

  it("preguntas sin dificultad válida sólo se usan como último recurso", () => {
    const r = selectByDifficulty(bank({ d1: 1, unknown: 5 }), new Set(), { 1: 1, 2: 2, 3: 1 }, 2, seededRng(7));
    assert.equal(r.questions.length, 4);
    assert.equal(r.actual_mix[1], 1);
    assert.equal(r.actual_mix.unknown, 3);
  });

  it("es reproducible con el mismo rng", () => {
    const eligible = bank({ d1: 8, d2: 8, d3: 8 });
    const a = selectByDifficulty(eligible, new Set([1, 9]), { 1: 1, 2: 2, 3: 1 }, 2, seededRng(42));
    const b = selectByDifficulty(eligible, new Set([1, 9]), { 1: 1, 2: 2, 3: 1 }, 2, seededRng(42));
    assert.deepEqual(a.questions.map((q) => q.id), b.questions.map((q) => q.id));
  });
});
