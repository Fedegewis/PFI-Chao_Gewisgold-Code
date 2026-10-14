// 7H.2 — GET /api/patient/sessions (historial propio del paciente).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@patient-own-sessions.test.com";

async function cleanTestData() {
  const patientIds = () => db("users").select("id").where("email", "like", `%${EMAIL_SUFFIX}`);
  const sessionIds = () => db("sessions").select("id").whereIn("patient_id", patientIds());
  const sectionIds = () => db("session_sections").select("id").whereIn("session_id", sessionIds());
  const sqIds = () => db("session_questions").select("id").whereIn("session_section_id", sectionIds());

  await db("answers").whereIn("session_question_id", sqIds()).del();
  await db("session_results").whereIn("session_id", sessionIds()).del();
  await db("session_questions").whereIn("session_section_id", sectionIds()).del();
  await db("session_sections").whereIn("session_id", sessionIds()).del();
  await db("sessions").whereIn("patient_id", patientIds()).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function insertSession({ patientId, professionalId, status, sectionSlug, completedAt, withResults }) {
  const [session] = await db("sessions")
    .insert({
      patient_id: patientId,
      professional_id: professionalId,
      status,
      started_at: status === "created" ? null : new Date(),
      completed_at: completedAt ?? (status === "completed" ? new Date() : null),
      abandoned_at: status === "abandoned" ? new Date() : null,
    })
    .returning("*");
  const section = await db("sections").where({ slug: sectionSlug }).first();
  await db("session_sections").insert({
    session_id: session.id,
    section_id: section.id,
    requested_count: 4,
    display_order: 1,
  });
  if (withResults) {
    await db("session_results").insert([
      {
        session_id: session.id,
        section_id: section.id,
        total_questions: 4, answered_questions: 4,
        correct_count: 3, incorrect_count: 1, unanswered_count: 0,
        accuracy: 0.75, completion_rate: 1.0,
        mean_latency_ms: 1500, min_latency_ms: 900, max_latency_ms: 2100, latency_std_ms: 400,
      },
      {
        session_id: session.id,
        section_id: null,
        total_questions: 4, answered_questions: 4,
        correct_count: 3, incorrect_count: 1, unanswered_count: 0,
        accuracy: 0.75, completion_rate: 1.0,
        mean_latency_ms: 1500, min_latency_ms: 900, max_latency_ms: 2100, latency_std_ms: 400,
      },
    ]);
  }
  return session;
}

describe("GET /api/patient/sessions (7H.2)", () => {
  let profA;
  let profB;
  let patientA;
  let patientB;
  let sessionCompleted;
  let sessionAbandoned;
  let sessionOtherPatient;

  before(async () => {
    await cleanTestData();
    const stamp = Date.now();
    [profA] = await db("users").insert({ role: "professional", name: "Prof A", email: `prof-a-${stamp}${EMAIL_SUFFIX}` }).returning("*");
    [profB] = await db("users").insert({ role: "professional", name: "Prof B", email: `prof-b-${stamp}${EMAIL_SUFFIX}` }).returning("*");
    [patientA] = await db("users").insert({ role: "patient", name: "Pat A", email: `pat-a-${stamp}${EMAIL_SUFFIX}`, professional_id: profA.id, age: 70 }).returning("*");
    [patientB] = await db("users").insert({ role: "patient", name: "Pat B", email: `pat-b-${stamp}${EMAIL_SUFFIX}`, professional_id: profB.id, age: 70 }).returning("*");

    sessionCompleted = await insertSession({
      patientId: patientA.id, professionalId: profA.id, status: "completed",
      sectionSlug: "orientacion_temporal", withResults: true,
    });
    sessionAbandoned = await insertSession({
      patientId: patientA.id, professionalId: profA.id, status: "abandoned",
      sectionSlug: "memoria_de_trabajo", withResults: false,
    });
    // Sesión antigua (30 días atrás), completed, para verificar que se devuelve historial completo.
    await insertSession({
      patientId: patientA.id, professionalId: profA.id, status: "completed",
      sectionSlug: "atencion_visual", withResults: true,
      completedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });
    sessionOtherPatient = await insertSession({
      patientId: patientB.id, professionalId: profB.id, status: "completed",
      sectionSlug: "orientacion_temporal", withResults: true,
    });
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  it("401 sin token", async () => {
    const res = await request(app).get("/api/patient/sessions");
    assert.equal(res.status, 401);
  });

  it("403 si el usuario es profesional", async () => {
    const res = await request(app).get("/api/patient/sessions").set("Authorization", authHeaderFor(profA));
    assert.equal(res.status, 403);
  });

  it("devuelve solo las sesiones del paciente autenticado", async () => {
    const res = await request(app).get("/api/patient/sessions").set("Authorization", authHeaderFor(patientA));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 3);
    for (const s of res.body) {
      assert.ok(!("professional_id" in s), "no debe exponer professional_id");
      assert.ok(!("correct_answer" in s));
      assert.ok(!("correct_answer_snapshot" in s));
      assert.ok(Array.isArray(s.sections));
    }
    const ids = res.body.map((s) => s.id);
    assert.ok(!ids.includes(sessionOtherPatient.id), "no debe incluir sesiones de otro paciente");
  });

  it("otro paciente autenticado no ve las sesiones de A", async () => {
    const res = await request(app).get("/api/patient/sessions").set("Authorization", authHeaderFor(patientB));
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, sessionOtherPatient.id);
  });

  it("completed incluye summary y sections", async () => {
    const res = await request(app).get("/api/patient/sessions").set("Authorization", authHeaderFor(patientA));
    const row = res.body.find((s) => s.id === sessionCompleted.id);
    assert.ok(row);
    assert.equal(row.status, "completed");
    assert.ok(row.summary);
    assert.equal(row.summary.total_questions, 4);
    assert.equal(row.summary.correct_count, 3);
    assert.equal(row.summary.accuracy, 0.75);
    assert.equal(row.summary.completion_rate, 1);
    assert.equal(row.summary.mean_latency_ms, 1500);
    assert.deepEqual(row.sections, [{ section_slug: "orientacion_temporal", section_name: "Orientación temporal" }]);
  });

  it("abandoned se devuelve sin summary", async () => {
    const res = await request(app).get("/api/patient/sessions").set("Authorization", authHeaderFor(patientA));
    const row = res.body.find((s) => s.id === sessionAbandoned.id);
    assert.ok(row);
    assert.equal(row.status, "abandoned");
    assert.ok(!("summary" in row));
    assert.ok(row.abandoned_at);
    assert.deepEqual(row.sections, [{ section_slug: "memoria_de_trabajo", section_name: "Memoria de trabajo" }]);
  });

  it("devuelve historial completo (no filtra al día actual)", async () => {
    const res = await request(app).get("/api/patient/sessions").set("Authorization", authHeaderFor(patientA));
    const oldSession = res.body.find((s) => s.sections?.[0]?.section_slug === "atencion_visual");
    assert.ok(oldSession, "la sesión antigua debe seguir presente");
    assert.equal(oldSession.status, "completed");
  });

  it("no acepta ningún parámetro de identidad desde el cliente", async () => {
    // Un intento de spoofear con query no altera el resultado.
    const res = await request(app)
      .get(`/api/patient/sessions?patient_id=${patientB.id}`)
      .set("Authorization", authHeaderFor(patientA));
    assert.equal(res.status, 200);
    const ids = res.body.map((s) => s.id);
    assert.ok(!ids.includes(sessionOtherPatient.id));
  });
});
