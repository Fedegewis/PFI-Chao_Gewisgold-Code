// Evaluación comparativa de prompts 3.4 vs 3.5 contra Ollama LOCAL.
//
// - Sólo casos SINTÉTICOS definidos en este archivo (sin DB, sin pacientes
//   reales, sin red externa: únicamente http://localhost:11434 por defecto).
// - Reproducible: mismas opciones que producción (AI_GENERATE_OPTIONS:
//   temperature 0.2, num_predict 300) + `seed` fijo por repetición.
// - Ambos prompts se evalúan con el MISMO validador vigente y los mismos
//   hechos (observationsBuilder real), con checkFacts=true.
//   · 3.5 → aspectsPolicy "discard" (política de producción).
//   · 3.4 → se reporta "validate" (como se usaba: summary + aspects) y
//     "discard" (sólo summary), para separar el efecto de aspects_to_review.
// - Mide tasas de aceptación por intento (sin reintento). No mide calidad
//   clínica ni utilidad: eso requiere revisión humana.
//
// Uso:
//   node scripts/eval/eval-prompts.js [--reps 3] [--model llama3.2:3b] [--out archivo.json]
//
// Variables: OLLAMA_URL (default http://localhost:11434).

import { writeFileSync } from "node:fs";

import { buildSessionAnalysisPrompt as buildV35, PROMPT_BUILDER_VERSION } from "../../src/services/ai/promptBuilder.js";
import { buildSessionAnalysisPrompt as buildV34 } from "./legacyPromptV34.js";
import { buildObservations } from "../../src/services/ai/observationsBuilder.js";
import { parseAndValidateSessionAnalysis } from "../../src/services/ai/responseValidator.js";
import { AI_GENERATE_OPTIONS } from "../../src/services/ai/analysisService.js";
import { GENERATION_VALIDATION_OPTIONS } from "../../src/services/ai/contentSafety.js";

function parseArgs(argv) {
  const a = { reps: 3, model: "llama3.2:3b", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--reps") a.reps = Number(argv[++i]);
    else if (argv[i] === "--model") a.model = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  if (!Number.isInteger(a.reps) || a.reps < 1) throw new Error("--reps debe ser entero >= 1");
  return a;
}

// ---- Casos sintéticos -----------------------------------------------------

function m({ total = 4, correct = 2, incorrect = 2 } = {}) {
  const answered = correct + incorrect;
  return {
    total_questions: total, answered_questions: answered,
    correct_count: correct, incorrect_count: incorrect, unanswered_count: total - answered,
    accuracy: answered ? correct / answered : null,
    completion_rate: total ? answered / total : 0,
    mean_latency_ms: 2500, min_latency_ms: 1500, max_latency_ms: 4000, latency_std_ms: 700,
  };
}

function cmp(accuracy, { latency = null, levelSame } = {}) {
  const c = { reference: { days_before: 4 }, accuracy: { current: 0.5, previous: 0.75, delta_percentage_points: -25, direction: accuracy } };
  if (latency) c.mean_latency_ms = { current: 3000, previous: 2500, direction: latency };
  if (levelSame !== undefined) c.difficulty_level = { current: 2, previous: levelSame === false ? 1 : 2, same: levelSame };
  return c;
}

const SECTIONS = {
  agenda: { slug: "orientacion_temporal", name: "Agenda de turnos", cognitive_domain_slugs: ["orientacion"] },
  super: { slug: "memoria_de_trabajo", name: "Lista del supermercado", cognitive_domain_slugs: ["memoria"] },
  casa: { slug: "atencion_visual", name: "Objetos de la casa", cognitive_domain_slugs: ["atencion", "memoria"] },
  medic: { slug: "memoria_prospectiva", name: "Tomar la medicación", cognitive_domain_slugs: ["memoria"] },
};

export const CASES = [
  { id: "C01-precision-total", section: "agenda", metrics: m({ correct: 4, incorrect: 0 }) },
  { id: "C02-bajo-desempeno", section: "super", metrics: m({ correct: 1, incorrect: 3 }) },
  { id: "C03-incompleta", section: "casa", metrics: m({ total: 6, correct: 2, incorrect: 1 }) },
  { id: "C04-similar-sin-comparacion", section: "agenda", metrics: m({ correct: 2, incorrect: 2 }) },
  { id: "C05-comparable-sube", section: "super", metrics: m({ correct: 3, incorrect: 1 }), comparison: cmp("subió", { latency: "bajó", levelSame: true }) },
  { id: "C06-comparable-baja", section: "casa", metrics: m({ correct: 1, incorrect: 3 }), comparison: cmp("bajó", { latency: "subió", levelSame: true }) },
  { id: "C07-dificultad-distinta", section: "agenda", metrics: m({ correct: 1, incorrect: 3 }), comparison: cmp("bajó", { levelSame: false }) },
  { id: "C08-nivel-desconocido", section: "super", metrics: m({ correct: 3, incorrect: 1 }), comparison: cmp("subió", { levelSame: null }) },
  { id: "C09-con-mood", section: "medic", metrics: m({ correct: 3, incorrect: 1 }), mood: "cansancio" },
  { id: "C10-medicacion-baja", section: "medic", metrics: m({ correct: 0, incorrect: 4 }) },
];

export function contextFor(c) {
  const section = { ...SECTIONS[c.section], metrics: c.metrics };
  return {
    schema_version: "2", language: "es", duration_seconds: 120,
    patient_reported_mood: c.mood ?? null,
    global: { metrics: c.metrics },
    sections: [section],
    cognitive_domains_touched: section.cognitive_domain_slugs,
    comparison_metrics: c.comparison ?? null,
  };
}

// ---- Ollama ---------------------------------------------------------------

async function generate({ url, model, prompt, seed }) {
  const t0 = Date.now();
  const res = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, format: "json", options: { ...AI_GENERATE_OPTIONS, seed }, keep_alive: "30m" }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const body = await res.json();
  return { text: body.response, latencyMs: Date.now() - t0 };
}

function judge(text, ctx, obs, aspectsPolicy) {
  try {
    parseAndValidateSessionAnalysis(text, ctx, {
      observations: obs.observations, followUp: obs.follow_up, ...GENERATION_VALIDATION_OPTIONS, aspectsPolicy,
    });
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: err?.info?.reason || err?.code || "error" };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.OLLAMA_URL || "http://localhost:11434";
  const tags = await fetch(`${url}/api/tags`).then((r) => r.json()).catch(() => null);
  if (!tags || !tags.models?.some((x) => x.name === args.model)) {
    console.log(`NO VERIFICADA: Ollama no disponible en ${url} o modelo ${args.model} ausente.`);
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (let rep = 1; rep <= args.reps; rep += 1) {
    for (const c of CASES) {
      const ctx = contextFor(c);
      const obs = buildObservations(ctx);
      for (const version of ["3.4", "3.5"]) {
        const build = version === "3.4" ? buildV34 : buildV35;
        const { prompt } = build(ctx, { observations: obs.observations });
        let out;
        try {
          out = await generate({ url, model: args.model, prompt, seed: rep });
        } catch (err) {
          results.push({ case: c.id, rep, version, error: err.message });
          continue;
        }
        const row = { case: c.id, rep, version, latency_ms: out.latencyMs, text: out.text };
        if (version === "3.4") {
          row.validate = judge(out.text, ctx, obs, "validate");
          row.discard = judge(out.text, ctx, obs, "discard");
        } else {
          row.discard = judge(out.text, ctx, obs, "discard");
        }
        results.push(row);
        // Resultados parciales: si la corrida se interrumpe, lo generado se conserva.
        if (args.out) writeFileSync(`${args.out}.partial.json`, JSON.stringify({ partial: true, done: results.length, total: args.reps * CASES.length * 2, results }, null, 2));
        console.log(`${c.id} rep${rep} v${version}: ${row.discard.ok ? "ACEPTADO" : `rechazado (${row.discard.reason})`}${row.validate ? ` · con aspects: ${row.validate.ok ? "ACEPTADO" : `rechazado (${row.validate.reason})`}` : ""}`);
      }
    }
  }

  const tally = (rows, key) => {
    const valid = rows.filter((r) => r[key]);
    const ok = valid.filter((r) => r[key].ok).length;
    const reasons = {};
    for (const r of valid) if (!r[key].ok) reasons[r[key].reason] = (reasons[r[key].reason] || 0) + 1;
    return { n: valid.length, accepted: ok, rate: valid.length ? ok / valid.length : null, reasons };
  };
  const v34 = results.filter((r) => r.version === "3.4");
  const v35 = results.filter((r) => r.version === "3.5");
  const summary = {
    model: args.model, reps: args.reps, cases: CASES.length,
    options: { ...AI_GENERATE_OPTIONS, seed: "1..reps" },
    current_prompt: PROMPT_BUILDER_VERSION,
    "3.4_summary_y_aspects": tally(v34, "validate"),
    "3.4_solo_summary": tally(v34, "discard"),
    "3.5_solo_summary": tally(v35, "discard"),
    errors: results.filter((r) => r.error).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (args.out) writeFileSync(args.out, JSON.stringify({ summary, results }, null, 2));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
