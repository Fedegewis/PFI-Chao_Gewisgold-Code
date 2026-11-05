// Evaluación comparativa de prompts contra Ollama LOCAL.
//
// Variantes: 3.4, 3.5, 3.6-pre (primera versión de 3.6, congelada en
// legacyPromptV36a.js + legacySessionFactsV36a.js, con format "json") y 3.6
// (vigente: fichas sin observaciones, párrafos proporcionales, JSON Schema
// como format y síntesis determinística cuando los datos no alcanzan).
// Por defecto se comparan 3.6-pre y 3.6; --only elige otras.
//
// - Sólo casos SINTÉTICOS definidos en este archivo (sin DB, sin pacientes
//   reales, sin red externa: únicamente http://localhost:11434 por defecto).
// - Reproducible: mismas opciones para las tres variantes
//   (AI_GENERATE_OPTIONS vigentes: temperature 0.2, num_predict 700) + `seed`
//   fijo por repetición. Mismo contexto, mismas observaciones y mismos
//   hechos (sessionFacts) para todas; 3.4 y 3.5 simplemente no usan los
//   hechos enriquecidos porque sus prompts no los incluían.
// - Cada variante se valida con su política:
//     3.4 → aspectsPolicy "validate" (summary + aspects, como se usaba)
//     3.5 → LEGACY_V35_VALIDATION_OPTIONS (sólo summary)
//     3.6 → GENERATION_VALIDATION_OPTIONS vigentes (paragraphs + aspects filtrados)
//   Todas con checkFacts y el validador vigente; 3.6 además con la ficha de
//   hechos enriquecida.
// - Métricas automáticas por salida: aceptación, largo, párrafos, oraciones,
//   aspectos devueltos/conservados, categorías de información cubiertas
//   (ánimo, nivel, tipos de pregunta, tiempos, antecedentes) y proporción de
//   oraciones que copian una observación automática. No miden calidad
//   clínica: los textos completos quedan en --out para revisión humana.
//
// Uso:
//   node scripts/eval/eval-prompts.js [--reps 3] [--model llama3.2:3b] [--out archivo.json] [--only 3.6-pre,3.6] [--cases C01,C02]
//
// Tiempo total estimado con reintentos: las repeticiones 1..N de un caso se
// usan como intentos sucesivos (se corta en el primero aceptado, máximo 3,
// como MAX_GENERATION_ATTEMPTS del worker); se suma su latencia.
//
// Variables: OLLAMA_URL (default http://localhost:11434).

import { writeFileSync } from "node:fs";

import { buildSessionAnalysisPrompt as buildV36, PROMPT_BUILDER_VERSION } from "../../src/services/ai/promptBuilder.js";
import { buildSessionAnalysisPrompt as buildV35 } from "./legacyPromptV35.js";
import { buildSessionAnalysisPrompt as buildV34 } from "./legacyPromptV34.js";
import { buildSessionAnalysisPrompt as buildV36a } from "./legacyPromptV36a.js";
import { buildSessionFacts as buildFactsV36a } from "./legacySessionFactsV36a.js";
import { buildAnalysisMaterials } from "../../src/services/ai/analysisMaterials.js";
import { parseAndValidateSessionAnalysis } from "../../src/services/ai/responseValidator.js";
import { AI_GENERATE_OPTIONS } from "../../src/services/ai/analysisService.js";
import {
  GENERATION_VALIDATION_OPTIONS,
  LEGACY_V35_VALIDATION_OPTIONS,
  normalizeText,
  splitSentences,
} from "../../src/services/ai/contentSafety.js";
import { QUESTION_TYPES } from "../../src/services/ai/sessionFacts.js";

function parseArgs(argv) {
  const a = { reps: 3, model: "llama3.2:3b", out: null, only: null, cases: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--reps") a.reps = Number(argv[++i]);
    else if (argv[i] === "--model") a.model = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--only") a.only = argv[++i].split(",");
    else if (argv[i] === "--cases") a.cases = argv[++i].split(",");
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  if (!Number.isInteger(a.reps) || a.reps < 1) throw new Error("--reps debe ser entero >= 1");
  return a;
}

// ---- Casos sintéticos -----------------------------------------------------
//
// q(tipo, conStimulus, resultado c|i|u, ms): una pregunta de la sesión.

function q(subdimension, stim, result, ms = 2500) {
  return {
    subdimension,
    has_stimulus: stim,
    answered: result !== "u",
    is_correct: result === "c" ? true : result === "i" ? false : null,
    response_time_ms: result === "u" ? null : ms,
  };
}

function metricsFrom(details) {
  const total = details.length;
  const answered = details.filter((d) => d.answered);
  const correct = answered.filter((d) => d.is_correct === true).length;
  const incorrect = answered.filter((d) => d.is_correct === false).length;
  const lat = answered.map((d) => d.response_time_ms);
  const mean = lat.length ? lat.reduce((x, y) => x + y, 0) / lat.length : null;
  const std = lat.length ? Math.sqrt(lat.reduce((x, y) => x + (y - mean) ** 2, 0) / lat.length) : null;
  return {
    total_questions: total,
    answered_questions: answered.length,
    correct_count: correct,
    incorrect_count: incorrect,
    unanswered_count: total - answered.length,
    accuracy: answered.length ? correct / answered.length : null,
    completion_rate: total ? answered.length / total : 0,
    mean_latency_ms: mean,
    min_latency_ms: lat.length ? Math.min(...lat) : null,
    max_latency_ms: lat.length ? Math.max(...lat) : null,
    latency_std_ms: std,
  };
}

// Especificación de la comparación con la sesión anterior. Los valores
// actuales salen de las métricas y del nivel del caso (antes eran fijos: C02
// decía precisión actual 0.5 con 1 de 4 correctas, y C04 nivel actual 2 con
// adaptive_level 3).
function cmp(accuracy, { latency = null, levelSame } = {}) {
  return { accuracy, latency: latency || "igual", levelSame };
}

const ACC_STEP = 0.25;
const LAT_STEP = 500;
function buildComparison(spec, metrics, level) {
  const accNow = metrics.accuracy;
  const accPrev = spec.accuracy === "bajó" ? Math.min(1, accNow + ACC_STEP)
    : spec.accuracy === "subió" ? Math.max(0, accNow - ACC_STEP) : accNow;
  const latNow = Math.round(metrics.mean_latency_ms);
  const latPrev = spec.latency === "subió" ? latNow - LAT_STEP : spec.latency === "bajó" ? latNow + LAT_STEP : latNow;
  const c = {
    section_slug: "x",
    reference: { days_before: 4, duration_seconds: 300 },
    accuracy: { current: accNow, previous: accPrev, delta_percentage_points: Math.round((accNow - accPrev) * 100), direction: spec.accuracy },
    completion_rate: { current: metrics.completion_rate, previous: 1, delta_percentage_points: Math.round((metrics.completion_rate - 1) * 100), direction: metrics.completion_rate < 1 ? "bajó" : "igual" },
    mean_latency_ms: { current: latNow, previous: latPrev, delta_ms: latNow - latPrev, direction: spec.latency },
  };
  if (spec.levelSame !== undefined) {
    const prevLevel = spec.levelSame === true ? level : spec.levelSame === false ? (level === 1 ? 2 : level - 1) : null;
    c.difficulty_level = { current: level, previous: prevLevel, same: spec.levelSame };
  }
  return c;
}

const SECTIONS = {
  agenda: { slug: "orientacion_temporal", name: "Agenda de turnos", cognitive_domain_slugs: ["orientacion"] },
  super: { slug: "memoria_de_trabajo", name: "Lista del supermercado", cognitive_domain_slugs: ["memoria"] },
  casa: { slug: "atencion_visual", name: "Objetos de la casa", cognitive_domain_slugs: ["atencion", "memoria"] },
  medic: { slug: "memoria_prospectiva", name: "Tomar la medicación", cognitive_domain_slugs: ["memoria"] },
  boleto: { slug: "atencion_y_calculo", name: "Pagar el boleto", cognitive_domain_slugs: ["atencion"] },
  barrio: { slug: "orientacion_espacial", name: "Camino al barrio", cognitive_domain_slugs: ["orientacion"] },
};

export const CASES = [
  {
    id: "C01-todo-correcto-calma", section: "casa", mood: "calma", level: 2, previous: 0,
    details: [q("reconocimiento_funcional", false, "c", 2100), q("memoria_de_ubicacion", true, "c", 4200), q("atencion_selectiva", false, "c", 2600), q("memoria_de_ubicacion", true, "c", 3900)],
  },
  {
    id: "C02-mas-incorrectas-cansancio-baja", section: "super", mood: "cansancio", level: 1, previous: 3,
    details: [q("retencion_y_evocacion", true, "i", 5200), q("retencion_y_evocacion", true, "i", 4800), q("actualizacion_de_memoria", false, "c", 2900), q("actualizacion_de_memoria", false, "i", 3600)],
    comparison: cmp("bajó", { latency: "subió", levelSame: true }),
  },
  {
    id: "C03-incompleta-tristeza", section: "agenda", mood: "tristeza", level: null, previous: 0,
    details: [q("orientacion_temporal", false, "c", 3100), q("orientacion_temporal", false, "i", 4100), q("juicio_y_resolucion", false, "u"), q("juicio_y_resolucion", false, "u")],
  },
  {
    id: "C04-similar-sin-animo-nivel-distinto", section: "boleto", mood: null, level: 3, previous: 1,
    details: [q("calculo_funcional", false, "c", 3000), q("calculo_funcional", false, "i", 3100), q("estimacion_y_redondeo", false, "c", 2800), q("estimacion_y_redondeo", false, "i", 2900)],
    comparison: cmp("bajó", { levelSame: false }),
  },
  {
    id: "C05-sube-alegria", section: "super", mood: "alegria", level: 2, previous: 2,
    details: [q("retencion_y_evocacion", true, "c", 2400), q("retencion_y_evocacion", true, "c", 2200), q("memoria_de_secuencia", true, "i", 4100), q("memoria_de_secuencia", true, "c", 3300)],
    comparison: cmp("subió", { latency: "bajó", levelSame: true }),
  },
  {
    id: "C06-nivel-desconocido-bien", section: "casa", mood: "bien", level: 2, previous: 1,
    details: [q("deteccion_de_anomalia", false, "c", 2000), q("retencion_de_escena", true, "c", 3500), q("retencion_de_escena", true, "i", 3900), q("deteccion_de_anomalia", false, "c", 2200)],
    comparison: cmp("subió", { levelSame: null }),
  },
  {
    id: "C07-medicacion-todo-incorrecto-cansancio", section: "medic", mood: "cansancio", level: 1, previous: 0,
    details: [q("comprension_funcional", true, "i", 6100), q("comprension_funcional", true, "i", 5400), q("retencion_y_evocacion", true, "i", 4700), q("retencion_y_evocacion", true, "i", 5000)],
  },
  {
    id: "C08-sin-tipos-sin-animo", section: "barrio", mood: null, level: null, previous: 0,
    details: [q(null, false, "c", 2500), q(null, false, "c", 2700), q(null, false, "i", 3300), q(null, false, "c", 2600)],
  },
  {
    id: "C09-correctas-mas-lentas-calma", section: "agenda", mood: "calma", level: 2, previous: 2,
    details: [q("orientacion_temporal", false, "c", 5200), q("orientacion_temporal", false, "c", 4900), q("planificacion_secuencial", false, "i", 1900), q("planificacion_secuencial", false, "c", 4400)],
    comparison: cmp("igual", { latency: "igual", levelSame: true }),
  },
  {
    id: "C10-stimulus-vs-vista-bien", section: "casa", mood: "bien", level: 3, previous: 0,
    details: [q("memoria_de_ubicacion", true, "i", 4500), q("memoria_de_ubicacion", true, "i", 4300), q("asociacion_objeto_lugar", false, "c", 2300), q("categorizacion_funcional", false, "c", 2100), q("discriminacion_entre_similares", false, "i", 3600)],
  },
];

export function inputFor(c) {
  const metrics = metricsFrom(c.details);
  const section = { ...SECTIONS[c.section], metrics };
  const context = {
    schema_version: "2", language: "es", duration_seconds: 240,
    ...(c.mood ? { patient_reported_mood: c.mood } : {}),
    global: { metrics },
    sections: [section],
    cognitive_domains_touched: section.cognitive_domain_slugs,
    ...(c.comparison ? { comparison_metrics: buildComparison(c.comparison, metrics, c.level) } : {}),
  };
  const input = {
    question_details: c.details.map((d) => ({ ...d, section_slug: section.slug })),
    adaptive_level: c.level,
    same_activity_previous_count: c.previous,
  };
  return { context, input };
}

// ---- Ollama ---------------------------------------------------------------

async function generate({ url, model, prompt, seed, format = "json" }) {
  const t0 = Date.now();
  const res = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, format, options: { ...AI_GENERATE_OPTIONS, seed }, keep_alive: "30m" }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return {
    text: body.response,
    latencyMs: Date.now() - t0,
    evalCount: body.eval_count ?? null,
    promptEvalCount: body.prompt_eval_count ?? null,
  };
}

// ---- Métricas -------------------------------------------------------------

const REPEAT_SIMILARITY = 0.75;

function stems(text) {
  return new Set((normalizeText(text).match(/[a-z]{4,}/g) || []).map((w) => w.slice(0, 5)));
}
function overlap(a, b) {
  const A = stems(a); const B = stems(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n += 1;
  return n / A.size;
}

function coverage(text, c) {
  const t = normalizeText(text);
  const typeKeys = c.details.map((d) => d.subdimension).filter(Boolean).flatMap((s) => QUESTION_TYPES[s].keys.map(normalizeText));
  return {
    mood: Boolean(c.mood) && /inform\w* (?:\w+ ){0,3}(?:sentir|animo|calma|cansancio|tristeza|alegria|bien)/.test(t),
    level: c.level !== null && /(?:nivel|dificultad) (?:\w+ ){0,3}(?:intermedi|mas accesible|mas exigente)/.test(t),
    types: typeKeys.some((k) => t.includes(k)),
    times: /tiempo/.test(t),
    history: /anterior|comparable|previa/.test(t),
    stimulus: /informacion previa|se oculta|a la vista/.test(t),
  };
}

// Oración copiada literalmente: su texto normalizado (sin el punto final)
// aparece completo dentro del prompt (datos u observaciones).
function isVerbatim(sentence, haystackNorm) {
  const n = normalizeText(sentence).replace(/[.!?]+$/, "").trim();
  return n.length >= 25 && haystackNorm.includes(n);
}

// Formato (lo que la gramática o un prompt mejor pueden evitar) vs contenido
// (afirmaciones no respaldadas o no permitidas).
const FORMAT_REASONS = new Set([
  "INVALID_JSON", "UNEXPECTED_FIELD", "SCHEMA_INVALID", "malformed_summary",
  "aspects_in_paragraph", "max_length_exceeded",
]);

function analyze(text, judged, c, observations, followUp, promptNorm = "") {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* inválido */ }
  const summary = judged.output?.summary
    ?? (Array.isArray(parsed?.paragraphs) ? parsed.paragraphs.join("\n\n") : (typeof parsed?.summary === "string" ? parsed.summary : ""));
  const sentences = splitSentences(summary);
  const repeated = sentences.filter((s) => observations.some((o) => overlap(s, o) >= REPEAT_SIMILARITY)).length;
  const verbatim = sentences.filter((s) => isVerbatim(s, promptNorm)).length;
  const verbatimObs = sentences.filter((s) => isVerbatim(s, normalizeText(observations.join(" | ")))).length;
  const aspectsRaw = Array.isArray(parsed?.aspects_to_review) ? parsed.aspects_to_review : [];
  const aspectsKept = judged.output ? judged.output.aspects_to_review : [];
  const aspectsRepeatFollowUp = aspectsRaw.filter((a) => typeof a === "string" && followUp.some((f) => overlap(a, f) >= REPEAT_SIMILARITY)).length;
  return {
    summary_chars: summary.length,
    paragraphs: summary ? summary.split(/\n\s*\n/).length : 0,
    sentences: sentences.length,
    sentences_repeating_observations: repeated,
    sentences_verbatim_from_prompt: verbatim,
    sentences_verbatim_observation: verbatimObs,
    aspects_returned: aspectsRaw.length,
    aspects_kept: aspectsKept.length,
    aspects_repeating_follow_up: aspectsRepeatFollowUp,
    coverage: coverage(`${summary}\n${aspectsKept.join("\n")}`, c),
  };
}

function judge(text, ctx, opts) {
  const dropped = [];
  try {
    const output = parseAndValidateSessionAnalysis(text, ctx, { ...opts, onAspectsFiltered: (d) => dropped.push(...d) });
    return { ok: true, reason: null, output, dropped };
  } catch (err) {
    return { ok: false, reason: err?.info?.reason || err?.code || "error", detail: err?.message, output: null, dropped };
  }
}

const VARIANTS = {
  "3.4": {
    build: (ctx, m) => buildV34(ctx, { observations: m.deterministic.observations }),
    opts: (m) => ({ observations: m.deterministic.observations, followUp: m.deterministic.follow_up, checkFacts: true, checkForm: true, aspectsPolicy: "validate" }),
  },
  "3.5": {
    build: (ctx, m) => buildV35(ctx, { observations: m.deterministic.observations }),
    opts: (m) => ({ observations: m.deterministic.observations, followUp: m.deterministic.follow_up, ...LEGACY_V35_VALIDATION_OPTIONS }),
  },
  // Primera versión de 3.6 (congelada): observaciones + oraciones de datos,
  // format "json". Se valida con el validador VIGENTE (mismas reglas que 3.6).
  "3.6-pre": {
    build: (ctx, m, raw) => {
      const facts = buildFactsV36a(ctx, raw);
      return { ...buildV36a(ctx, { observations: m.deterministic.observations, facts }), facts };
    },
    opts: (m, built) => ({
      observations: m.deterministic.observations,
      followUp: m.deterministic.follow_up,
      factSentences: built.facts.sentences,
      detail: built.facts.sheet,
      ...GENERATION_VALIDATION_OPTIONS,
    }),
  },
  "3.6": {
    build: (ctx, m) => ({ ...buildV36(ctx, { observations: m.deterministic.observations, facts: m.facts }), format: m.outputSchema }),
    opts: (m) => m.validationOptions,
    deterministicWhen: (m) => !m.sufficient,
  },
};
const DEFAULT_VERSIONS = ["3.6-pre", "3.6"];

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function round(x, d = 2) { return x === null ? null : Number(x.toFixed(d)); }

function tally(rows) {
  const deterministic = rows.filter((r) => r.deterministic);
  const valid = rows.filter((r) => !r.error && !r.deterministic);
  const ok = valid.filter((r) => r.judged.ok);
  const reasons = {};
  for (const r of valid) if (!r.judged.ok) reasons[r.judged.reason] = (reasons[r.judged.reason] || 0) + 1;
  const droppedReasons = {};
  for (const r of ok) for (const d of r.judged.dropped) droppedReasons[d.reason] = (droppedReasons[d.reason] || 0) + 1;
  const cov = (k) => round(mean(ok.map((r) => (r.metrics.coverage[k] ? 1 : 0))));
  const rejected = valid.filter((r) => !r.judged.ok);
  const formatRej = rejected.filter((r) => FORMAT_REASONS.has(r.judged.reason)).length;
  const sumOk = (k) => ok.reduce((a, r) => a + r.metrics[k], 0);
  return {
    n: valid.length,
    deterministic: deterministic.length,
    accepted: ok.length,
    rate: valid.length ? round(ok.length / valid.length) : null,
    rejected_format: formatRej,
    rejected_content: rejected.length - formatRej,
    rejected_reasons: reasons,
    accepted_only: {
      mean_summary_chars: round(mean(ok.map((r) => r.metrics.summary_chars)), 0),
      mean_paragraphs: round(mean(ok.map((r) => r.metrics.paragraphs))),
      mean_sentences: round(mean(ok.map((r) => r.metrics.sentences))),
      share_sentences_repeating_observations: round(
        ok.reduce((a, r) => a + r.metrics.sentences_repeating_observations, 0) / Math.max(1, ok.reduce((a, r) => a + r.metrics.sentences, 0)),
      ),
      share_sentences_verbatim_from_prompt: round(sumOk("sentences_verbatim_from_prompt") / Math.max(1, sumOk("sentences"))),
      share_sentences_verbatim_observation: round(sumOk("sentences_verbatim_observation") / Math.max(1, sumOk("sentences"))),
      share_with_verbatim_observation: round(mean(ok.map((r) => (r.metrics.sentences_verbatim_observation > 0 ? 1 : 0)))),
      min_summary_chars: ok.length ? Math.min(...ok.map((r) => r.metrics.summary_chars)) : null,
      max_summary_chars: ok.length ? Math.max(...ok.map((r) => r.metrics.summary_chars)) : null,
      mean_aspects_returned: round(mean(ok.map((r) => r.metrics.aspects_returned))),
      mean_aspects_kept: round(mean(ok.map((r) => r.metrics.aspects_kept))),
      share_with_3plus_aspects: round(mean(ok.map((r) => (r.metrics.aspects_kept >= 3 ? 1 : 0)))),
      aspects_dropped_reasons: droppedReasons,
      coverage: { mood: cov("mood"), level: cov("level"), types: cov("types"), times: cov("times"), history: cov("history"), stimulus: cov("stimulus") },
    },
    mean_latency_s: round(mean(valid.map((r) => r.latency_ms / 1000)), 1),
    max_latency_s: valid.length ? round(Math.max(...valid.map((r) => r.latency_ms / 1000)), 1) : null,
    mean_eval_tokens: round(mean(valid.map((r) => r.eval_count).filter((x) => x !== null)), 0),
    max_eval_tokens: valid.length ? Math.max(...valid.map((r) => r.eval_count ?? 0)) : null,
    mean_prompt_tokens: round(mean(valid.map((r) => r.prompt_eval_count).filter((x) => x !== null && x !== undefined)), 0),
    retries: retryEstimate(rows),
  };
}

// Intentos sucesivos = repeticiones 1..N del mismo caso (máximo 3).
function retryEstimate(rows) {
  const byCase = new Map();
  for (const r of rows) {
    if (r.error) continue;
    if (!byCase.has(r.case)) byCase.set(r.case, []);
    byCase.get(r.case).push(r);
  }
  const perCase = [];
  for (const [id, list] of byCase) {
    const seq = list.sort((a, b) => a.rep - b.rep).slice(0, 3);
    let total = 0; let attempts = 0; let accepted = false; let deterministic = false;
    for (const r of seq) {
      if (r.deterministic) { deterministic = true; accepted = true; break; }
      attempts += 1; total += r.latency_ms;
      if (r.judged.ok) { accepted = true; break; }
    }
    perCase.push({ case: id, attempts, total_s: round(total / 1000, 1), accepted, deterministic });
  }
  return {
    cases_with_result: perCase.filter((c) => c.accepted).length,
    cases: perCase.length,
    mean_attempts: round(mean(perCase.filter((c) => !c.deterministic).map((c) => c.attempts))),
    mean_total_s: round(mean(perCase.map((c) => c.total_s)), 1),
    sum_total_s: round(perCase.reduce((a, c) => a + c.total_s, 0), 1),
    per_case: perCase,
  };
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
  const versions = args.only || DEFAULT_VERSIONS;
  for (const v of versions) if (!VARIANTS[v]) throw new Error(`Variante desconocida: ${v}`);
  const cases = args.cases ? CASES.filter((c) => args.cases.some((p) => c.id.startsWith(p))) : CASES;

  const results = [];
  const total = args.reps * cases.length * versions.length;
  for (let rep = 1; rep <= args.reps; rep += 1) {
    for (const c of cases) {
      const { context, input } = inputFor(c);
      const materials = buildAnalysisMaterials(context, input);
      const raw = {
        questionDetails: input.question_details,
        adaptiveLevel: input.adaptive_level,
        sameActivityPreviousCount: input.same_activity_previous_count,
      };
      for (const version of versions) {
        const v = VARIANTS[version];
        if (v.deterministicWhen && v.deterministicWhen(materials)) {
          // Sin llamada a Ollama: el backend persiste un resultado determinístico.
          results.push({ case: c.id, rep, version, deterministic: true, latency_ms: 0 });
          console.log(`${c.id} rep${rep} v${version}: DETERMINÍSTICO (datos insuficientes, sin llamada a Ollama)`);
          continue;
        }
        const built = v.build(context, materials, raw);
        let out;
        try {
          out = await generate({ url, model: args.model, prompt: built.prompt, seed: rep, format: built.format || "json" });
        } catch (err) {
          results.push({ case: c.id, rep, version, error: err.message });
          continue;
        }
        const judged = judge(out.text, context, v.opts(materials, built));
        const metrics = analyze(out.text, judged, c, materials.deterministic.observations, materials.deterministic.follow_up, normalizeText(built.prompt));
        const row = {
          case: c.id, rep, version, latency_ms: out.latencyMs, eval_count: out.evalCount,
          prompt_eval_count: out.promptEvalCount, text: out.text, judged, metrics,
        };
        results.push(row);
        if (args.out) writeFileSync(`${args.out}.partial.json`, JSON.stringify({ partial: true, done: results.length, total, results }, null, 2));
        console.log(`${c.id} rep${rep} v${version}: ${judged.ok ? `ACEPTADO (aspectos ${metrics.aspects_kept}/${metrics.aspects_returned})` : `rechazado (${judged.reason})`} ${(out.latencyMs / 1000).toFixed(0)}s`);
      }
    }
  }

  const summary = {
    model: args.model, reps: args.reps, cases: cases.length,
    options: { ...AI_GENERATE_OPTIONS, seed: "1..reps" },
    format: { "3.6-pre": "json", "3.6": "JSON Schema (outputSchema)" },
    current_prompt: PROMPT_BUILDER_VERSION,
    by_version: Object.fromEntries(versions.map((v) => [v, tally(results.filter((r) => r.version === v))])),
    errors: results.filter((r) => r.error).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (args.out) writeFileSync(args.out, JSON.stringify({ summary, results }, null, 2));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}
