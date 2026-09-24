import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@patients-test.com";

async function cleanTestData() {
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Patients API", () => {
  let profA;
  let profB;
  let profAAuth;
  let profBAuth;
  let profNew;
  let profNewAuth;
  let profAPatient1;
  let profAPatient2;
  let profBPatient1;
  let patientAuth;

  before(async () => {
    await cleanTestData();

    [profA] = await db("users")
      .insert({
        role: "professional",
        name: "Prof A",
        email: `prof-a-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");
    [profB] = await db("users")
      .insert({
        role: "professional",
        name: "Prof B",
        email: `prof-b-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");
    [profNew] = await db("users")
      .insert({
        role: "professional",
        name: "Prof New",
        email: `prof-new-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");

    profAAuth = authHeaderFor(profA);
    profBAuth = authHeaderFor(profB);
    profNewAuth = authHeaderFor(profNew);

    [profAPatient1] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente A1",
        email: `a1-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
      })
      .returning("*");
    [profAPatient2] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente A2",
        email: `a2-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
      })
      .returning("*");
    [profBPatient1] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente B1",
        email: `b1-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profB.id,
      })
      .returning("*");

    patientAuth = authHeaderFor(profAPatient1);
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("GET /api/patients", () => {
    it("returns only patients owned by the authenticated professional", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", profAAuth);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      const ids = res.body.map((p) => p.id).sort();
      assert.deepEqual(ids, [profAPatient1.id, profAPatient2.id].sort());
      for (const p of res.body) {
        assert.equal(p.role, "patient");
        assert.equal(p.professional_id, profA.id);
      }
    });

    it("does not leak patients from another professional", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", profBAuth);
      assert.equal(res.status, 200);
      const ids = res.body.map((p) => p.id);
      assert.ok(!ids.includes(profAPatient1.id));
      assert.ok(!ids.includes(profAPatient2.id));
      assert.deepEqual(ids, [profBPatient1.id]);
    });

    it("returns [] for a professional with no patients", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", profNewAuth);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
    });

    it("rejects requests without a token", async () => {
      const res = await request(app).get("/api/patients");
      assert.equal(res.status, 401);
    });

    it("rejects requests from a patient token", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
    });

    it("ignores a professional_id query/body attempt to impersonate", async () => {
      const res = await request(app)
        .get(`/api/patients?professional_id=${profA.id}`)
        .set("Authorization", profBAuth);
      assert.equal(res.status, 200);
      const ids = res.body.map((p) => p.id);
      assert.ok(!ids.includes(profAPatient1.id));
    });
  });

  describe("POST /api/users (removed in 6C.7)", () => {
    it("returns 404 (pacientes se crean sólo por invitación)", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", profBAuth)
        .send({
          name: "Nuevo B",
          email: `nuevo-b-${Date.now()}${EMAIL_SUFFIX}`,
          age: 70,
        });
      assert.equal(res.status, 404);
    });
  });

  describe("DELETE /api/patients/:id", () => {
    async function createOwnedPatient(professional) {
      const [row] = await db("users")
        .insert({
          role: "patient",
          name: `Paciente Del ${Date.now()}`,
          email: `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      return row;
    }

    it("permanently deletes a patient owned by the authenticated professional", async () => {
      const patient = await createOwnedPatient(profA);
      const res = await request(app)
        .delete(`/api/patients/${patient.id}`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 204);

      const found = await db("users").where({ id: patient.id }).first();
      assert.equal(found, undefined);
    });

    it("cascades sessions, session_sections, session_questions, answers and session_results", async () => {
      const patient = await createOwnedPatient(profA);

      const [section] = await db("sections").select("id").limit(1);
      const [question] = await db("questions")
        .where({ section_id: section.id })
        .select("id", "response_type")
        .limit(1);

      const [session] = await db("sessions")
        .insert({
          patient_id: patient.id,
          professional_id: profA.id,
          status: "completed",
          started_at: db.fn.now(),
          completed_at: db.fn.now(),
        })
        .returning("*");

      const [sessionSection] = await db("session_sections")
        .insert({
          session_id: session.id,
          section_id: section.id,
          requested_count: 1,
          display_order: 1,
        })
        .returning("*");

      const [sessionQuestion] = await db("session_questions")
        .insert({
          session_section_id: sessionSection.id,
          question_id: question.id,
          display_order: 1,
          prompt_snapshot: "test prompt",
          options_snapshot: JSON.stringify(["a", "b", "c", "d"]),
          correct_answer_snapshot: 0,
          response_type: question.response_type,
        })
        .returning("*");

      const [answer] = await db("answers")
        .insert({
          session_question_id: sessionQuestion.id,
          selected_answer: 0,
          is_correct: true,
          response_time_ms: 1500,
        })
        .returning("*");

      const [sessionResult] = await db("session_results")
        .insert({
          session_id: session.id,
          section_id: null,
          total_questions: 1,
          answered_questions: 1,
          correct_count: 1,
          incorrect_count: 0,
          unanswered_count: 0,
          accuracy: 1,
          completion_rate: 1,
          mean_latency_ms: 1500,
          min_latency_ms: 1500,
          max_latency_ms: 1500,
          latency_std_ms: 0,
        })
        .returning("*");

      const res = await request(app)
        .delete(`/api/patients/${patient.id}`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 204);

      assert.equal(await db("users").where({ id: patient.id }).first(), undefined);
      assert.equal(await db("sessions").where({ id: session.id }).first(), undefined);
      assert.equal(await db("session_sections").where({ id: sessionSection.id }).first(), undefined);
      assert.equal(await db("session_questions").where({ id: sessionQuestion.id }).first(), undefined);
      assert.equal(await db("answers").where({ id: answer.id }).first(), undefined);
      assert.equal(await db("session_results").where({ id: sessionResult.id }).first(), undefined);

      const questionStillThere = await db("questions").where({ id: question.id }).first();
      assert.ok(questionStillThere, "shared question bank must not be deleted");
      const professionalStillThere = await db("users").where({ id: profA.id }).first();
      assert.ok(professionalStillThere, "professional must not be deleted");
    });

    it("does not allow professional A to delete a patient of professional B", async () => {
      const patientOfB = await createOwnedPatient(profB);
      const res = await request(app)
        .delete(`/api/patients/${patientOfB.id}`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 404);

      const stillThere = await db("users").where({ id: patientOfB.id }).first();
      assert.ok(stillThere, "patient of professional B must remain");
    });

    it("returns 404 for a non-existent patient", async () => {
      const res = await request(app)
        .delete(`/api/patients/99999999`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 404);
    });

    it("returns 404 for an invalid id", async () => {
      const res = await request(app)
        .delete(`/api/patients/not-a-number`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 404);
    });

    it("ignores a professional_id body attempt to impersonate", async () => {
      const patientOfB = await createOwnedPatient(profB);
      const res = await request(app)
        .delete(`/api/patients/${patientOfB.id}`)
        .set("Authorization", profAAuth)
        .send({ professional_id: profB.id });
      assert.equal(res.status, 404);
      const stillThere = await db("users").where({ id: patientOfB.id }).first();
      assert.ok(stillThere);
    });

    it("rejects patient tokens", async () => {
      const patient = await createOwnedPatient(profA);
      const res = await request(app)
        .delete(`/api/patients/${patient.id}`)
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
      const stillThere = await db("users").where({ id: patient.id }).first();
      assert.ok(stillThere);
    });

    it("rejects unauthenticated requests", async () => {
      const patient = await createOwnedPatient(profA);
      const res = await request(app).delete(`/api/patients/${patient.id}`);
      assert.equal(res.status, 401);
      const stillThere = await db("users").where({ id: patient.id }).first();
      assert.ok(stillThere);
    });
  });
});
