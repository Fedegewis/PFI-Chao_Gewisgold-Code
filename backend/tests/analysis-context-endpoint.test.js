// v3.4 — Tests del endpoint determinístico `/analysis-context`.
//
// Verifica ownership, estados HTTP, y que devuelve activities + evidence
// + comparison_metrics + observations + follow_up, siempre a partir de
// datos reales de la sesión. NO depende de Ollama.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@analysis-context.test.com";
let profA, profB, patientA, sectionRow;

async function cleanTestData() {
  const pids = () => db("users").select("id").where("email", "like", `%${EMAIL_SUFFIX}`);
  const sids = () => db("sessions").select("id").whereIn("patient_id", pids());
  await db("session_analyses").whereIn("session_id", sids()).del();
  const ssids = () => db("session_sections").select("id").whereIn("session_id", sids());
  const sqids = () => db("session_questions").select("id").whereIn("session_section_id", ssids());
  await db("answers").whereIn("session_question_id", sqids()).del();
  await db("session_results").whereIn("session_id", sids()).del();
  await db("session_questions").whereIn("session_section_id", ssids()).del();
  await db("session_sections").whereIn("session_id", sids()).del();
  await db("sessions").whereIn("patient_id", pids()).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function makeCompletedSession({ professional = profA, patient = patientA, metrics } = {}) {
  const m = metrics || {
    total_questions: 9, answered_questions: 9,
    correct_count: 4, incorrect_count: 5, unanswered_count: 0,
    accuracy: 0.4444, completion_rate: 1,
    mean_latency_ms: 7800, min_latency_ms: 3000, max_latency_ms: 12000, latency_std_ms: 2200,
  };
  const [s] = await db("sessions").insert({
    patient_id: patient.id, professional_id: professional.id,
    status: "completed", started_at: new Date(Date.now() - 70000), completed_at: new Date(),
  }).returning("*");
  await db("session_sections").insert({
    session_id: s.id, section_id: sectionRow.id, requested_count: m.total_questions, display_order: 1,
  });
  await db("session_results").insert([
    { session_id: s.id, section_id: sectionRow.id, ...m },
    { session_id: s.id, section_id: null, ...m },
  ]);
  return s;
}

async function makeInProgressSession() {
  const [s] = await db("sessions").insert({
    patient_id: patientA.id, professional_id: profA.id,
    status: "in_progress", started_at: new Date(),
  }).returning("*");
  return s;
}

describe("GET /api/sessions/:id/analysis-context (v3.4)", () => {
  before(async () => {
    await cleanTestData();
    const stamp = Date.now();
    [profA] = await db("users").insert({
      role: "professional", name: "Prof CTX", email: `prof-${stamp}${EMAIL_SUFFIX}`,
    }).returning("*");
    [profB] = await db("users").insert({
      role: "professional", name: "Prof CTX B", email: `prof-b-${stamp}${EMAIL_SUFFIX}`,
    }).returning("*");
    [patientA] = await db("users").insert({
      role: "patient", name: "Pat CTX", email: `pat-${stamp}${EMAIL_SUFFIX}`,
      professional_id: profA.id, age: 70,
    }).returning("*");
    sectionRow = await db("sections").where({ slug: "memoria_de_trabajo" }).first();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  it("401 sin token", async () => {
    const ses = await makeCompletedSession();
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`);
    assert.equal(r.status, 401);
  });

  it("403 con paciente", async () => {
    const ses = await makeCompletedSession();
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(patientA));
    assert.equal(r.status, 403);
  });

  it("404 cuando el profesional no es dueño", async () => {
    const ses = await makeCompletedSession();
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(profB));
    assert.equal(r.status, 404);
  });

  it("400 cuando la sesión no está completada", async () => {
    const ses = await makeInProgressSession();
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 400);
  });

  it("200 sin análisis previo: devuelve activities + evidence + observations", async () => {
    const ses = await makeCompletedSession();
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.source, "deterministic");

    // Activities
    assert.ok(Array.isArray(r.body.activities));
    assert.equal(r.body.activities.length, 1);
    assert.equal(r.body.activities[0].slug, "memoria_de_trabajo");
    assert.equal(typeof r.body.activities[0].name, "string");

    // Evidence
    assert.ok(Array.isArray(r.body.evidence));
    assert.ok(r.body.evidence.length > 0);
    assert.ok(r.body.evidence.some((e) => e.scope === "global" && e.metric === "accuracy"));

    // comparison_metrics: null u objeto, dependiendo de si hay previas
    // (los tests crean varias sesiones del mismo paciente — pueden existir).
    assert.ok(r.body.comparison_metrics === null || typeof r.body.comparison_metrics === "object");

    // Observations + follow_up
    assert.ok(Array.isArray(r.body.observations));
    assert.ok(r.body.observations.length >= 2);
    assert.ok(
      r.body.observations.some((o) =>
        o.includes("más respuestas incorrectas que correctas")
      )
    );
    assert.ok(Array.isArray(r.body.follow_up));
    assert.ok(r.body.follow_up.length >= 1);
  });

  it("200 primera sesión del paciente: observa 'No existen todavía sesiones comparables'", async () => {
    // Paciente aislado — ninguna previa, ningún comparable posible.
    const [patientSolo] = await db("users").insert({
      role: "patient", name: "Solo", email: `pat-solo-${Date.now()}${EMAIL_SUFFIX}`,
      professional_id: profA.id, age: 70,
    }).returning("*");
    const ses = await makeCompletedSession({ patient: patientSolo });
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.comparison_metrics, null);
    assert.ok(
      r.body.observations.some((o) =>
        o.includes("No existen todavía sesiones comparables")
      )
    );
  });

  it("200 funciona también cuando ya hay análisis exitoso", async () => {
    const ses = await makeCompletedSession();
    await db("session_analyses").insert({
      session_id: ses.id, status: "ok", model: "test",
      schema_version: "3", prompt_version: "3.4",
      analysis: {
        schema_version: "3", summary: "x", aspects_to_review: [],
        activities: [], evidence: [],
      },
      latency_ms: 100,
    });
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.observations));
  });

  it("no incluye summary ni aspects_to_review (es sólo determinístico)", async () => {
    const ses = await makeCompletedSession();
    const r = await request(app).get(`/api/sessions/${ses.id}/analysis-context`)
      .set("Authorization", authHeaderFor(profA));
    assert.equal(r.status, 200);
    assert.equal(r.body.summary, undefined);
    assert.equal(r.body.aspects_to_review, undefined);
  });
});
