// Mecanismo adaptativo de dificultad (v1).
//
// Módulo PURO: sin DB, sin Ollama, sin process.env, sin req/res. Toda la
// decisión es determinística y reproducible a partir de sus entradas; la
// aleatoriedad de la selección entra únicamente por el `rng` inyectado.
//
// Unidad de adaptación: paciente × actividad (section). Cada sesión guarda
// un snapshot inmutable del nivel con el que se armó y de la decisión que lo
// produjo (session_sections.adaptive_level / adaptive_decision).
//
// Los umbrales son REGLAS OPERATIVAS configurables de la aplicación, no
// criterios clínicos: no diagnostican ni miden capacidades cognitivas.
// Sólo deciden qué mezcla de preguntas (dificultad interna 1/2/3 del banco)
// recibe la próxima sesión de esa actividad.
//
// Reglas de la versión 1:
//   - Nivel inicial: 2 (sin historial adaptativo en la actividad).
//   - Nivel actual = nivel de la sesión adaptativa MÁS RECIENTE de la
//     actividad, en cualquier estado. Así, una sesión creada tras un cambio
//     fija el nuevo nivel aunque todavía no se haya completado: crear otra
//     sesión no puede volver a aplicar el mismo cambio sin evidencia nueva.
//   - Evidencia = sesiones COMPLETADAS del nivel actual, desde el último
//     cambio de nivel (la ventana se reinicia al cambiar). Las abandonadas,
//     en curso o creadas no aportan evidencia; tampoco las completadas sin
//     respuestas puntuables. Las históricas sin nivel adaptativo se ignoran.
//   - Se acumulan sesiones (de la más reciente hacia atrás) hasta reunir
//     al menos 2 sesiones y 6 respuestas puntuadas, examinando como máximo 4.
//   - Precisión agrupada ≥ 0,80 → sube un nivel; ≤ 0,40 → baja un nivel;
//     intermedia o evidencia insuficiente → se mantiene. Topes 1 y 3.
//   - La latencia NO participa en esta versión.

export const ADAPTIVE_VERSION = "1";

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 3;

export const ADAPTIVE_CONFIG = Object.freeze({
  initialLevel: 2,
  minSessions: 2,
  minScoredAnswers: 6,
  maxLookbackSessions: 4,
  upThreshold: 0.8,
  downThreshold: 0.4,
  // Mezcla objetivo de dificultades por nivel (proporciones que suman 1).
  mixes: Object.freeze({
    1: Object.freeze({ 1: 0.75, 2: 0.25, 3: 0 }),
    2: Object.freeze({ 1: 0.25, 2: 0.5, 3: 0.25 }),
    3: Object.freeze({ 1: 0, 2: 0.25, 3: 0.75 }),
  }),
});

const DIFFICULTIES = [1, 2, 3];
// Tolerancia para comparar proporciones (p. ej. 4/5 = 0,8 contra 0,8).
const EPSILON = 1e-9;

export function isValidLevel(value) {
  return Number.isInteger(value) && value >= MIN_LEVEL && value <= MAX_LEVEL;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Calcula el nivel de la próxima sesión de una actividad.
 *
 * @param {Array<{session_id:number, status:string, adaptive_level:number|null,
 *   correct_count:number|null, incorrect_count:number|null}>} history
 *   Sesiones del paciente en ESTA actividad, ordenadas de la más reciente a
 *   la más antigua. Pueden incluir sesiones sin nivel (se ignoran).
 * @param {object} [config]
 * @returns {object} decisión serializable (se persiste como adaptive_decision).
 */
export function computeAdaptiveLevel(history, config = ADAPTIVE_CONFIG) {
  const thresholds = {
    up: config.upThreshold,
    down: config.downThreshold,
    min_sessions: config.minSessions,
    // "responses" (no "answers"): el payload profesional no debe contener la
    // palabra "answers" (test de no exposición de respuestas individuales).
    min_scored_responses: config.minScoredAnswers,
    max_lookback_sessions: config.maxLookbackSessions,
  };
  const adaptive = (Array.isArray(history) ? history : []).filter((h) => isValidLevel(h?.adaptive_level));

  if (adaptive.length === 0) {
    return {
      version: ADAPTIVE_VERSION,
      level: config.initialLevel,
      previous_level: null,
      change: "initial",
      rule: "initial_level",
      evidence: emptyEvidence(),
      thresholds,
    };
  }

  const currentLevel = adaptive[0].adaptive_level;
  const window = [];
  let scored = 0;
  let correct = 0;
  for (const h of adaptive) {
    // Ventana reiniciada: sólo cuentan sesiones posteriores al último cambio.
    if (h.adaptive_level !== currentLevel) break;
    if (h.status !== "completed") continue;
    const c = toCount(h.correct_count);
    const s = c + toCount(h.incorrect_count);
    // Una sesión sin respuestas puntuables (p. ej. sólo likert) no es evidencia.
    if (s === 0) continue;
    window.push(h.session_id);
    correct += c;
    scored += s;
    const enough = window.length >= config.minSessions && scored >= config.minScoredAnswers;
    if (enough || window.length >= config.maxLookbackSessions) break;
  }

  const evidence = {
    session_ids: window,
    sessions_count: window.length,
    correct_count: correct,
    scored_count: scored,
    accuracy: scored > 0 ? Number((correct / scored).toFixed(4)) : null,
  };

  const base = { version: ADAPTIVE_VERSION, previous_level: currentLevel, evidence, thresholds };

  if (window.length < config.minSessions || scored < config.minScoredAnswers) {
    return { ...base, level: currentLevel, change: "hold", rule: "insufficient_evidence" };
  }

  const accuracy = correct / scored;
  if (accuracy >= config.upThreshold - EPSILON) {
    if (currentLevel >= MAX_LEVEL) {
      return { ...base, level: currentLevel, change: "hold", rule: "max_level_reached" };
    }
    return { ...base, level: currentLevel + 1, change: "up", rule: "high_accuracy_sustained" };
  }
  if (accuracy <= config.downThreshold + EPSILON) {
    if (currentLevel <= MIN_LEVEL) {
      return { ...base, level: currentLevel, change: "hold", rule: "min_level_reached" };
    }
    return { ...base, level: currentLevel - 1, change: "down", rule: "low_accuracy_sustained" };
  }
  return { ...base, level: currentLevel, change: "hold", rule: "intermediate_accuracy" };
}

function emptyEvidence() {
  return { session_ids: [], sessions_count: 0, correct_count: 0, scored_count: 0, accuracy: null };
}

// Orden de preferencia entre dificultades para desempatar y para el fallback:
// primero la más cercana a `reference`, y ante empate, la más cercana al nivel
// de la sesión; si persiste, la más baja (la opción más accesible).
function orderByCloseness(reference, level) {
  return [...DIFFICULTIES].sort((a, b) =>
    Math.abs(a - reference) - Math.abs(b - reference)
    || Math.abs(a - level) - Math.abs(b - level)
    || a - b
  );
}

/**
 * Reparte `count` preguntas entre dificultades según la mezcla del nivel,
 * por el método del resto mayor (determinístico).
 * @returns {{1:number, 2:number, 3:number}}
 */
export function buildDifficultyTargets(level, count, config = ADAPTIVE_CONFIG) {
  if (!isValidLevel(level)) throw new RangeError(`Nivel inválido: ${level}`);
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Cantidad inválida: ${count}`);
  const mix = config.mixes[level];
  const targets = { 1: 0, 2: 0, 3: 0 };
  const remainders = [];
  let assigned = 0;
  for (const d of DIFFICULTIES) {
    const exact = (mix[d] || 0) * count;
    targets[d] = Math.floor(exact + EPSILON);
    assigned += targets[d];
    remainders.push({ d, rest: exact - targets[d] });
  }
  const tieOrder = orderByCloseness(level, level);
  remainders.sort((a, b) =>
    (b.rest - a.rest > EPSILON ? 1 : a.rest - b.rest > EPSILON ? -1 : 0)
    || tieOrder.indexOf(a.d) - tieOrder.indexOf(b.d)
  );
  for (let i = 0; assigned < count; i += 1) {
    const entry = remainders[i % remainders.length];
    if ((mix[entry.d] || 0) > 0) {
      targets[entry.d] += 1;
      assigned += 1;
    } else if (i >= remainders.length * 2) {
      // Defensa: una mezcla sin proporciones positivas no debería existir.
      targets[level] += 1;
      assigned += 1;
    }
  }
  return targets;
}

function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Selecciona preguntas respetando la mezcla objetivo, con fallback.
 *
 * Fallback para cada dificultad objetivo d (en orden de cuota descendente):
 *   1. preguntas de d no vistas recientemente;
 *   2. preguntas no recientes de la dificultad más cercana a d (distancia 1,
 *      luego 2; empate → la más cercana al nivel de la sesión);
 *   3. preguntas de d vistas recientemente;
 *   4. preguntas recientes de las dificultades cercanas (mismo orden que 2);
 *   5. cualquier pregunta elegible restante (p. ej. sin dificultad válida).
 * Nunca duplica preguntas. El caller garantiza eligible.length >= total.
 *
 * @param {Array<{id:number, difficulty:number|null}>} eligible
 * @param {Set<number>} recentIds
 * @param {{1:number,2:number,3:number}} targets
 * @param {number} level
 * @param {() => number} rng
 * @returns {{ questions: Array, actual_mix: object, fallback_count: number, recent_count: number }}
 */
export function selectByDifficulty(eligible, recentIds, targets, level, rng = Math.random) {
  const total = DIFFICULTIES.reduce((s, d) => s + (targets[d] || 0), 0);
  const pools = new Map();
  for (const d of [...DIFFICULTIES, null]) pools.set(d, { fresh: [], recent: [] });
  for (const q of shuffle(eligible, rng)) {
    const d = DIFFICULTIES.includes(q.difficulty) ? q.difficulty : null;
    pools.get(d)[recentIds.has(q.id) ? "recent" : "fresh"].push(q);
  }

  const picked = [];
  let fallbackCount = 0;
  let recentCount = 0;
  const take = (d, kind, n, isFallback) => {
    const pool = pools.get(d)[kind];
    const taken = pool.splice(0, Math.max(0, n));
    picked.push(...taken);
    if (isFallback) fallbackCount += taken.length;
    if (kind === "recent") recentCount += taken.length;
    return taken.length;
  };

  const order = orderByCloseness(level, level).sort((a, b) => (targets[b] || 0) - (targets[a] || 0));
  const missing = {};
  for (const d of order) missing[d] = (targets[d] || 0) - take(d, "fresh", targets[d] || 0, false);

  for (const kind of ["fresh", "recent"]) {
    for (const d of order) {
      if (missing[d] <= 0) continue;
      if (kind === "recent") missing[d] -= take(d, "recent", missing[d], false);
      for (const alt of orderByCloseness(d, level)) {
        if (missing[d] <= 0) break;
        if (alt === d) continue;
        missing[d] -= take(alt, kind, missing[d], true);
      }
    }
  }

  let remaining = total - picked.length;
  for (const kind of ["fresh", "recent"]) {
    if (remaining > 0) remaining -= take(null, kind, remaining, true);
  }

  const actualMix = { 1: 0, 2: 0, 3: 0, unknown: 0 };
  for (const q of picked) {
    if (DIFFICULTIES.includes(q.difficulty)) actualMix[q.difficulty] += 1;
    else actualMix.unknown += 1;
  }
  if (actualMix.unknown === 0) delete actualMix.unknown;

  return {
    questions: shuffle(picked, rng),
    actual_mix: actualMix,
    fallback_count: fallbackCount,
    recent_count: recentCount,
  };
}
