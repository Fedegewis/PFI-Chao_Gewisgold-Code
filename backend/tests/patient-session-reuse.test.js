// Anti-duplicados de POST /api/patient/sessions (prod 2026-11-11): un doble
// toque con el servidor despertando creaba dos sesiones y el frontend quedaba
// respondiendo sobre la que nunca se inició. El backend ahora devuelve la
// sesión `created` reciente de las mismas actividades en lugar de crear otra.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { REUSE_CREATED_SESSION_MINUTES } from "../src/routes/sessions.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@session-reuse-test.com";
const SLUG_PREFIX = "reuse_test";
const SOURCE = "reuse_test_fixture";

async function clean() {
  const userIds = await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).pluck("id");
  if (userIds.length) {
    const sessionIds = await db("sessions").whereIn("patient_id", userIds).pluck("id");
    if (sessionIds.length) {
      const ssIds = await db("session_sections").whereIn("session_id", sessionIds).pluck("id");
      if (ssIds.length) await db("session_questions").whereIn("session_section_id", ssIds).del();
      await db("session_sections").whereIn("session_id", sessionIds).del();
      await db("sessions").whereIn("id", sessionIds).del();
    }
  }
  await db("questions").where("source", SOURCE).del();
  await db("sections").where("slug", "like", `${SLUG_PREFIX}_%`).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("POST /api/patient/sessions — reutiliza la sesión pendiente", { concurrency: false }, () => {
  let professional;
  let secA;
  let secB;
  let seq = 0;

  async function newPatient() {
    seq += 1;
    const [patient] = await db("users")
      .insert({
        role: "patient",
        name: `Paciente reuse ${seq}`,
        email: `pat-${seq}-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: professional.id,
        max_questions: 2,
      })
      .returning("*");
    return { patient, auth: authHeaderFor(patient) };
  }

  function create(auth, sectionIds, extra = {}) {
    return request(app)
      .post("/api/patient/sessions")
      .set("Authorization", auth)
      .send({ sections: sectionIds.map((id) => ({ section_id: id })), ...extra });
  }

  async function pendingCount(patientId) {
    const row = await db("sessions").where({ patient_id: patientId, status: "created" }).count({ c: "*" }).first();
    return Number(row.c);
  }

  before(async () => {
    await clean();
    [professional] = await db("users")
      .insert({ role: "professional", name: "Prof reuse", email: `prof-${Date.now()}${EMAIL_SUFFIX}` })
      .returning("*");
    const sections = [];
    for (const suffix of ["a", "b"]) {
      const [section] = await db("sections")
        .insert({ slug: `${SLUG_PREFIX}_${suffix}_${Date.now()}`, name: `Reuse ${suffix}`, is_active: true, display_order: 300 })
        .returning("*");
      sections.push(section);
      await db("questions").insert(
        Array.from({ length: 6 }, (_, i) => ({
          section_id: section.id,
          prompt: `Reuse ${suffix} ${i + 1}`,
          response_type: "multiple_choice",
          options: JSON.stringify(["A", "B", "C", "D"]),
          correct_answer: 0,
          is_active: true,
          is_validated: true,
          source: SOURCE,
        }))
      );
    }
    [secA, secB] = sections;
  });

  after(async () => {
    await clean();
    await db.destroy();
  });

  it("dos pedidos seguidos para la misma actividad devuelven la misma sesión y las mismas preguntas", async () => {
    const { patient, auth } = await newPatient();
    const first = await create(auth, [secA.id]);
    const second = await create(auth, [secA.id]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    assert.equal(second.body.status, "created");
    assert.deepEqual(
      second.body.sections[0].questions.map((q) => q.id),
      first.body.sections[0].questions.map((q) => q.id)
    );
    assert.equal(second.body.sections[0].questions[0].correct_answer_snapshot, undefined);
    assert.equal(second.body.sections[0].adaptive_level, undefined);
    assert.equal(await pendingCount(patient.id), 1);
  });

  it("dos pedidos simultáneos (doble toque) crean una sola sesión", async () => {
    const { patient, auth } = await newPatient();
    const [r1, r2] = await Promise.all([create(auth, [secA.id]), create(auth, [secA.id])]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
    assert.equal(r1.body.id, r2.body.id);
    assert.equal(await pendingCount(patient.id), 1);
  });

  it("la sesión reutilizada se puede iniciar y responder", async () => {
    const { auth } = await newPatient();
    await create(auth, [secA.id]);
    const reused = await create(auth, [secA.id]);
    const start = await request(app).post(`/api/sessions/${reused.body.id}/start`).set("Authorization", auth);
    assert.equal(start.status, 200);
    const answer = await request(app)
      .post(`/api/sessions/${reused.body.id}/answers`)
      .set("Authorization", auth)
      .send({ session_question_id: reused.body.sections[0].questions[0].id, selected_answer: 0, response_time_ms: 1500 });
    assert.equal(answer.status, 201);
  });

  it("otra actividad crea otra sesión", async () => {
    const { patient, auth } = await newPatient();
    const a = await create(auth, [secA.id]);
    const b = await create(auth, [secB.id]);
    assert.equal(b.status, 201);
    assert.notEqual(b.body.id, a.body.id);
    assert.equal(await pendingCount(patient.id), 2);
  });

  it("un conjunto distinto de actividades no reutiliza una sesión de una sola", async () => {
    const { auth } = await newPatient();
    const single = await create(auth, [secA.id]);
    const both = await create(auth, [secA.id, secB.id]);
    assert.equal(both.status, 201);
    assert.notEqual(both.body.id, single.body.id);
  });

  it("una sesión ya iniciada no se reutiliza", async () => {
    const { auth } = await newPatient();
    const first = await create(auth, [secA.id]);
    await request(app).post(`/api/sessions/${first.body.id}/start`).set("Authorization", auth);
    const second = await create(auth, [secA.id]);
    assert.equal(second.status, 201);
    assert.notEqual(second.body.id, first.body.id);
  });

  it(`pasados ${REUSE_CREATED_SESSION_MINUTES} minutos se crea una sesión nueva`, async () => {
    const { auth } = await newPatient();
    const first = await create(auth, [secA.id]);
    await db("sessions")
      .where("id", first.body.id)
      .update({ created_at: db.raw(`now() - interval '${REUSE_CREATED_SESSION_MINUTES + 1} minutes'`) });
    const second = await create(auth, [secA.id]);
    assert.equal(second.status, 201);
    assert.notEqual(second.body.id, first.body.id);
  });

  it("no reutiliza sesiones de otro paciente", async () => {
    const one = await newPatient();
    const two = await newPatient();
    const a = await create(one.auth, [secA.id]);
    const b = await create(two.auth, [secA.id]);
    assert.equal(b.status, 201);
    assert.notEqual(b.body.id, a.body.id);
    assert.equal(b.body.patient_id, two.patient.id);
  });
});
