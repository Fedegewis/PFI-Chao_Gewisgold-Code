// 7J.2 — Generación automática asíncrona del análisis IA.
//
// Cubre el aislamiento (complete siempre responde ok aunque IA falle) y la
// distinción generating/ok/failed/no_analysis en GET.
//
// Ejecuta contra menteactiva_test (aislamiento por NODE_ENV=test + fail-closed).

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import {
  setAutoAnalysisTrigger,
  resetAutoAnalysisTrigger,
} from "../src/routes/sessions.js";
import { analysisRouteDeps } from "../src/routes/analysis.js";
import { generateSessionAnalysis } from "../src/services/ai/analysisService.js";
import { PROMPT_BUILDER_VERSION } from "../src/services/ai/promptBuilder.js";

const EMAIL_SUFFIX = "@auto-analysis.test.com";
const MODEL = "test-model-auto";

let profA;
let patientA;
let sectionRow;
let questionIds;

async function cleanTestData() {
  const patientIds = () => db("users").select("id").where("email", "like", `%${EMAIL_SUFFIX}`);
  const sessionIds = () => db("sessions").select("id").whereIn("patient_id", patientIds());
  await db("session_analyses").whereIn("session_id", sessionIds()).del();
  const sectionIds = () => db("session_sections").select("id").whereIn("session_id", sessionIds());
  const sqIds = () => db("session_questions").select("id").whereIn("session_section_id", sectionIds());
  await db("answers").whereIn("session_question_id", sqIds()).del();
  await db("session_results").whereIn("session_id", sessionIds()).del();
  await db("session_questions").whereIn("session_section_id", sectionIds()).del();
  await db("session_sections").whereIn("session_id", sessionIds()).del();
  await db("sessions").whereIn("patient_id", patientIds()).del();
  await db("questions").where("source", "auto_analysis_test_fixture").del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function createSessionInProgress() {
  const [session] = await db("sessions")
    .insert({
      patient_id: patientA.id,
      professional_id: profA.id,
      status: "in_progress",
      started_at: new Date(),
    })
    .returning("*");
  const [ss] = await db("session_sections")
    .insert({ session_id: session.id, section_id: sectionRow.id, requested_count: 2, display_order: 1 })
    .returning("*");
  // 2 preguntas: usamos las fixture ya insertadas.
  const [sq1] = await db("session_questions").insert({
    session_section_id: ss.id, question_id: questionIds[0], display_order: 1,
    prompt_snapshot: "Q1", options_snapshot: JSON.stringify(["a","b","c","d"]),
    correct_answer_snapshot: 0, response_type: "multiple_choice",
  }).returning("*");
  const [sq2] = await db("session_questions").insert({
    session_section_id: ss.id, question_id: questionIds[1], display_order: 2,
    prompt_snapshot: "Q2", options_snapshot: JSON.stringify(["a","b","c","d"]),
    correct_answer_snapshot: 1, response_type: "multiple_choice",
  }).returning("*");
  await db("answers").insert([
    { session_question_id: sq1.id, selected_answer: 0, is_correct: true, response_time_ms: 1000 },
    { session_question_id: sq2.id, selected_answer: 1, is_correct: true, response_time_ms: 1200 },
  ]);
  return session;
}

describe("7J.2 — Generación automática y estado generating", () => {
  before(async () => {
    await cleanTestData();
    const stamp = Date.now();
    [profA] = await db("users")
      .insert({ role: "professional", name: "Prof Auto", email: `prof-${stamp}${EMAIL_SUFFIX}` })
      .returning("*");
    [patientA] = await db("users")
      .insert({ role: "patient", name: "Pat Auto", email: `pat-${stamp}${EMAIL_SUFFIX}`, professional_id: profA.id, age: 70 })
      .returning("*");
    sectionRow = await db("sections").where({ slug: "orientacion_temporal" }).first();
    // Fixture: 2 preguntas validated con source dedicado.
    const inserted = await db("questions").insert([
      { section_id: sectionRow.id, prompt: "Q1", response_type: "multiple_choice", options: JSON.stringify(["a","b","c","d"]), correct_answer: 0, difficulty: 1, is_active: true, is_validated: true, source: "auto_analysis_test_fixture" },
      { section_id: sectionRow.id, prompt: "Q2", response_type: "multiple_choice", options: JSON.stringify(["a","b","c","d"]), correct_answer: 1, difficulty: 1, is_active: true, is_validated: true, source: "auto_analysis_test_fixture" },
    ]).returning("id");
    questionIds = inserted.map((r) => r.id);
  });

  beforeEach(async () => {
    resetAutoAnalysisTrigger();
    analysisRouteDeps.generate = null;
  });

  after(async () => {
    resetAutoAnalysisTrigger();
    analysisRouteDeps.generate = null;
    await cleanTestData();
    await db.destroy();
  });

  it("complete responde sin esperar la inferencia y dispara el trigger", async () => {
    const session = await createSessionInProgress();
    let triggered = 0;
    setAutoAnalysisTrigger((sid) => { triggered += 1; assert.equal(sid, session.id); });
    await request(app).post(`/api/sessions/${session.id}/start`).set("Authorization", authHeaderFor(patientA));
    const t0 = Date.now();
    const res = await request(app).post(`/api/sessions/${session.id}/complete`).set("Authorization", authHeaderFor(patientA));
    const dt = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "completed");
    assert.ok(dt < 1000, `complete debería responder rápido (fue ${dt} ms)`);
    // El trigger se dispara sincrónicamente en el handler.
    assert.equal(triggered, 1);
  });

  it("complete responde ok aunque el pipeline IA falle en segundo plano (aislamiento)", async () => {
    // Simula un trigger que corre un pipeline que rechaza. Debe usar el patrón
    // real (setImmediate + Promise + catch) para no filtrar la excepción al
    // handler HTTP. Este test valida ese contrato: si el trigger sigue ese
    // patrón, /complete responde 200 y la sesión queda completed sin importar
    // lo que le pase a la IA.
    const session = await createSessionInProgress();
    setAutoAnalysisTrigger(() => {
      setImmediate(() => {
        Promise.reject(new Error("boom async")).catch(() => { /* aislado */ });
      });
    });
    await request(app).post(`/api/sessions/${session.id}/start`).set("Authorization", authHeaderFor(patientA));
    const res = await request(app).post(`/api/sessions/${session.id}/complete`).set("Authorization", authHeaderFor(patientA));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "completed");
    const row = await db("sessions").where({ id: session.id }).first();
    assert.equal(row.status, "completed");
    const results = await db("session_results").where({ session_id: session.id });
    assert.ok(results.length >= 1);
  });

  it("Ollama offline durante auto-trigger: sesión sigue completed y fila failed queda persistida", async () => {
    const session = await createSessionInProgress();
    let triggerDone;
    const triggerFinished = new Promise((r) => { triggerDone = r; });
    setAutoAnalysisTrigger((sid) => {
      setImmediate(async () => {
        try {
          const { OllamaClientError, OllamaErrorCodes } = await import("../src/services/ai/errors.js");
          const stub = async () => { throw new OllamaClientError(OllamaErrorCodes.OLLAMA_OFFLINE, "boom"); };
          await generateSessionAnalysis(
            { sessionId: sid, force: false },
            { generate: stub, config: { model: MODEL, url: "http://x", timeoutMs: 5000, enabled: true } },
          ).catch(() => {});
        } finally {
          triggerDone();
        }
      });
    });
    await request(app).post(`/api/sessions/${session.id}/start`).set("Authorization", authHeaderFor(patientA));
    const res = await request(app).post(`/api/sessions/${session.id}/complete`).set("Authorization", authHeaderFor(patientA));
    assert.equal(res.status, 200);
    // La sesión sigue completed sin importar el resultado IA.
    const row = await db("sessions").where({ id: session.id }).first();
    assert.equal(row.status, "completed");
    // Esperar el trigger background antes de leer la fila failed.
    await triggerFinished;
    const failed = await db("session_analyses")
      .where({ session_id: session.id, status: "failed" })
      .first();
    assert.ok(failed);
    assert.equal(failed.error_code, "OLLAMA_OFFLINE");
  });

  it("GET distingue no_analysis / generating / ok / last_failed", async () => {
    // Sesión completada sin ningún análisis.
    const session = await createSessionInProgress();
    await request(app).post(`/api/sessions/${session.id}/start`).set("Authorization", authHeaderFor(patientA));
    await request(app).post(`/api/sessions/${session.id}/complete`).set("Authorization", authHeaderFor(patientA));

    // 1. no_analysis: 404
    let r = await request(app).get(`/api/sessions/${session.id}/analysis`).set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 404);
    assert.equal(r.body.status, "no_analysis");

    // 2. Insertar una fila generating y volver a consultar: 202
    const [gen] = await db("session_analyses").insert({
      session_id: session.id, status: "generating", model: MODEL,
      schema_version: "1", prompt_version: PROMPT_BUILDER_VERSION,
    }).returning("*");
    r = await request(app).get(`/api/sessions/${session.id}/analysis`).set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 202);
    assert.equal(r.body.status, "generating");

    // 3. Promover a ok: 200 con analysis
    await db("session_analyses").where({ id: gen.id }).update({
      status: "ok",
      analysis: {
        schema_version: "3",
        summary: "s",
        aspects_to_review: [],
        activities: [{ slug: sectionRow.slug, name: sectionRow.name, cognitive_domain_slugs: [] }],
        evidence: [{ scope: "global", metric: "accuracy", value: 1 }],
      },
      latency_ms: 100,
    });
    r = await request(app).get(`/api/sessions/${session.id}/analysis`).set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ok");
    assert.ok(r.body.analysis);
    assert.equal(r.body.regenerating, false);

    // 4. Insertar una nueva fila failed más reciente. Sigue habiendo ok compatible,
    //    entonces GET debe seguir devolviendo ok.
    await db("session_analyses").insert({
      session_id: session.id, status: "failed", error_code: "OLLAMA_TIMEOUT", model: MODEL,
      schema_version: "1", prompt_version: PROMPT_BUILDER_VERSION,
    });
    r = await request(app).get(`/api/sessions/${session.id}/analysis`).set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ok");

    // 5. Borrar la fila ok: sin ok y con la failed → last_failed 200.
    await db("session_analyses").where({ session_id: session.id, status: "ok" }).del();
    r = await request(app).get(`/api/sessions/${session.id}/analysis`).set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "last_failed");
  });

  it("una fila generating fresca junto con una ok reporta regenerating:true en GET", async () => {
    const session = await createSessionInProgress();
    await request(app).post(`/api/sessions/${session.id}/start`).set("Authorization", authHeaderFor(patientA));
    await request(app).post(`/api/sessions/${session.id}/complete`).set("Authorization", authHeaderFor(patientA));

    await db("session_analyses").insert({
      session_id: session.id, status: "ok",
      analysis: {
        schema_version: "3",
        summary: "s",
        aspects_to_review: [],
        activities: [{ slug: sectionRow.slug, name: sectionRow.name, cognitive_domain_slugs: [] }],
        evidence: [{ scope: "global", metric: "accuracy", value: 1 }],
      },
      model: MODEL, schema_version: "1", prompt_version: PROMPT_BUILDER_VERSION, latency_ms: 100,
    });
    // Ahora un intento de regeneración manual en curso.
    await db("session_analyses").insert({
      session_id: session.id, status: "generating",
      model: MODEL, schema_version: "1", prompt_version: PROMPT_BUILDER_VERSION,
    });
    const r = await request(app).get(`/api/sessions/${session.id}/analysis`).set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ok");
    assert.equal(r.body.regenerating, true);
  });
});
