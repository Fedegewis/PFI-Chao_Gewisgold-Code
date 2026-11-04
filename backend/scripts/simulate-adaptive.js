// Simulación reproducible del mecanismo adaptativo de dificultad (v1).
//
// DATOS 100 % SINTÉTICOS. No usa base de datos, ni pacientes reales, ni
// Ollama. Cada perfil define una probabilidad de respuesta correcta por
// dificultad (1/2/3) elegida a mano para ilustrar el comportamiento de las
// reglas; NO representa desempeño de personas ni tiene valor clínico.
//
// Uso:  node scripts/simulate-adaptive.js [--sessions 10] [--questions 4] [--seed 2026]
// La salida (Markdown) es idéntica para los mismos parámetros.

import {
  ADAPTIVE_CONFIG,
  buildDifficultyTargets,
  computeAdaptiveLevel,
} from "../src/services/adaptiveDifficulty.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const SESSIONS = arg("sessions", 10);
const QUESTIONS = arg("questions", 4);
const SEED = arg("seed", 2026);

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

// Perfiles sintéticos. "abandon" marca sesiones abandonadas (índice 1-based).
const PROFILES = [
  { key: "alto", label: "Desempeño sintético alto", p: { 1: 0.97, 2: 0.92, 3: 0.85 } },
  { key: "bajo", label: "Desempeño sintético bajo", p: { 1: 0.4, 2: 0.25, 3: 0.15 } },
  { key: "mixto", label: "Desempeño sintético mixto", p: { 1: 0.9, 2: 0.65, 3: 0.35 } },
  {
    key: "evolucion",
    label: "Evolución sintética (mejora gradual, con una sesión abandonada)",
    // La probabilidad sube con el número de sesión: ilustra una trayectoria.
    p: (n) => ({ 1: Math.min(0.98, 0.5 + 0.06 * n), 2: Math.min(0.95, 0.3 + 0.07 * n), 3: Math.min(0.9, 0.15 + 0.07 * n) }),
    abandon: [4],
  },
];

const LEVEL_NAME = { 1: "1", 2: "2", 3: "3" };

function simulate(profile, rng) {
  const history = []; // más reciente primero
  const rows = [];
  for (let n = 1; n <= SESSIONS; n += 1) {
    const decision = computeAdaptiveLevel(history);
    const targets = buildDifficultyTargets(decision.level, QUESTIONS);
    const p = typeof profile.p === "function" ? profile.p(n) : profile.p;
    const abandoned = (profile.abandon || []).includes(n);
    let correct = 0;
    if (!abandoned) {
      for (const d of [1, 2, 3]) {
        for (let i = 0; i < targets[d]; i += 1) if (rng() < p[d]) correct += 1;
      }
    }
    history.unshift({
      session_id: n,
      status: abandoned ? "abandoned" : "completed",
      adaptive_level: decision.level,
      correct_count: abandoned ? null : correct,
      incorrect_count: abandoned ? null : QUESTIONS - correct,
    });
    rows.push({ n, decision, targets, correct, abandoned });
  }
  return rows;
}

function fmtEvidence(e) {
  if (!e.sessions_count) return "—";
  return `${e.correct_count}/${e.scored_count} en sesiones ${e.session_ids.join(", ")} (${(e.accuracy * 100).toFixed(1).replace(".", ",")} %)`;
}

const rng = seededRng(SEED);
const out = [];
out.push("# Simulación del mecanismo adaptativo de dificultad (datos sintéticos)");
out.push("");
out.push(`Parámetros: ${SESSIONS} sesiones por perfil, ${QUESTIONS} preguntas por sesión, semilla ${SEED}.`);
out.push(`Reglas: nivel inicial ${ADAPTIVE_CONFIG.initialLevel}; mínimo ${ADAPTIVE_CONFIG.minSessions} sesiones y ${ADAPTIVE_CONFIG.minScoredAnswers} respuestas; máx. ${ADAPTIVE_CONFIG.maxLookbackSessions} sesiones examinadas; sube con ≥ ${ADAPTIVE_CONFIG.upThreshold * 100} %, baja con ≤ ${ADAPTIVE_CONFIG.downThreshold * 100} %.`);
out.push("");
out.push("> Datos generados por programa. No provienen de usuarios reales y no tienen interpretación clínica.");

for (const profile of PROFILES) {
  const rows = simulate(profile, rng);
  out.push("");
  out.push(`## ${profile.label}`);
  out.push("");
  out.push(`Trayectoria de niveles: ${rows.map((r) => LEVEL_NAME[r.decision.level]).join(" → ")}`);
  out.push("");
  out.push("| Sesión | Nivel | Cambio | Regla | Evidencia usada | Mezcla (F/M/D) | Correctas |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const mix = `${r.targets[1]}/${r.targets[2]}/${r.targets[3]}`;
    out.push(`| ${r.n} | ${r.decision.level} | ${r.decision.change} | ${r.decision.rule} | ${fmtEvidence(r.decision.evidence)} | ${mix} | ${r.abandoned ? "abandonada" : `${r.correct}/${QUESTIONS}`} |`);
  }
}

console.log(out.join("\n"));
