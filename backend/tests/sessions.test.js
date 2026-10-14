import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

let professional;
let patient;
let testSectionId;
let profAuth;

async function cleanTestData() {
  // Defense in depth: los deletes se acotan al scope propio del test.
  const testPatientIds = () => db("users").select("id").where("email", "like", "%@test.com");
  const testSessionIds = () => db("sessions").select("id").whereIn("patient_id", testPatientIds());
  const testSectionIds = () => db("session_sections").select("id").whereIn("session_id", testSessionIds());

  await db("session_questions").whereIn("session_section_id", testSectionIds()).del();
  await db("session_sections").whereIn("session_id", testSessionIds()).del();
  await db("sessions").whereIn("patient_id", testPatientIds()).del();
  await db("questions").where("source", "test_fixture").del();
  await db("sections").where("slug", "like", "test_%").del();
  await db("users").where("email", "like", "%@test.com").del();
}

async function createTestFixtures() {
  await cleanTestData();

  [professional] = await db("users")
    .insert({ role: "professional", name: "Dr. Test", email: `prof-${Date.now()}@test.com` })
    .returning("*");

  profAuth = authHeaderFor(professional);

  [patient] = await db("users")
    .insert({
      role: "patient",
      name: "Paciente Test",
      email: `patient-${Date.now()}@test.com`,
      age: 72,
      professional_id: professional.id,
    })
    .returning("*");

  const [section] = await db("sections")
    .insert({
      slug: `test_section_${Date.now()}`,
      name: "Sección de test",
      description: "Sección para tests",

      is_active: true,
      display_order: 100,
    })
    .returning("*");

  testSectionId = section.id;

  const questionsToInsert = [];
  for (let i = 0; i < 5; i++) {
    questionsToInsert.push({
      section_id: testSectionId,
      prompt: `Pregunta de test ${i + 1}`,
      response_type: "multiple_choice",
      options: JSON.stringify(["Opción A", "Opción B", "Opción C"]),
      correct_answer: 0,
      is_active: true,
      is_validated: true,
      source: "test_fixture",
    });
  }
  await db("questions").insert(questionsToInsert);
}

describe("Users API", () => {
  before(async () => {
    await createTestFixtures();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("POST /api/users (removed in 6C.7)", () => {
    it("returns 404 for POST /api/users because pacientes se crean sólo por invitación", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", profAuth)
        .send({ name: "N", email: `n-${Date.now()}@test.com` });
      assert.equal(res.status, 404);
    });
  });

  describe("GET /api/users/:id", () => {
    it("returns a patient owned by the professional", async () => {
      const res = await request(app)
        .get(`/api/users/${patient.id}`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.id, patient.id);
      assert.equal(res.body.role, "patient");
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).get(`/api/users/${patient.id}`);
      assert.equal(res.status, 401);
    });

    it("returns 404 for non-existent user", async () => {
      const res = await request(app)
        .get("/api/users/99999")
        .set("Authorization", profAuth);
      assert.equal(res.status, 404);
    });

    it("returns 400 for invalid user id", async () => {
      const res = await request(app)
        .get("/api/users/abc")
        .set("Authorization", profAuth);
      assert.equal(res.status, 400);
    });
  });

  describe("POST /api/sessions", () => {
    it("creates a session with 1 section", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 3 }],
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.patient_id, patient.id);
      assert.equal(res.body.professional_id, professional.id);
      assert.equal(res.body.status, "created");
      assert.equal(res.body.sections.length, 1);
      assert.equal(res.body.sections[0].requested_count, 3);
      assert.equal(res.body.sections[0].questions.length, 3);
    });

    it("creates a session with multiple sections", async () => {
      const [section2] = await db("sections")
        .insert({
          slug: `test_section2_${Date.now()}`,
          name: "Sección de test 2",
          description: "Segunda sección",
    
          is_active: true,
          display_order: 101,
        })
        .returning("*");

      await db("questions").insert([
        {
          section_id: section2.id,
          prompt: "Pregunta sección 2",
          response_type: "multiple_choice",
          options: JSON.stringify(["A", "B", "C"]),
          correct_answer: 1,
          is_active: true,
          is_validated: true,
          source: "test_fixture",
        },
        {
          section_id: section2.id,
          prompt: "Pregunta sección 2 - segunda",
          response_type: "multiple_choice",
          options: JSON.stringify(["A", "B", "C"]),
          correct_answer: 2,
          is_active: true,
          is_validated: true,
          source: "test_fixture",
        },
      ]);

      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [
          { section_id: testSectionId, question_count: 2 },
          { section_id: section2.id, question_count: 2 },
        ],
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.sections.length, 2);
      assert.equal(res.body.sections[0].questions.length, 2);
      assert.equal(res.body.sections[1].questions.length, 2);
      assert.equal(res.body.sections[0].display_order, 1);
      assert.equal(res.body.sections[1].display_order, 2);
    });

    it("returns 404 for non-existent patient", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: 99999,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 1 }],
      });
      assert.equal(res.status, 404);
    });

    // 6E.1 (H1): professional_id del body es ignorado — se deriva del JWT.
    it("ignores professional_id from body and uses JWT identity (6E.1 H1)", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: 99999,  // valor falso, debe ser ignorado
        sections: [{ section_id: testSectionId, question_count: 1 }],
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.professional_id, professional.id);
    });

    // 6E.1 (H1): ownership — profesional A NO puede crear sesión para paciente de B.
    it("professional A cannot create session for patient of professional B (6E.1 H1)", async () => {
      const [profB] = await db("users")
        .insert({ role: "professional", name: "Prof B", email: `profB-${Date.now()}@test.com` })
        .returning("*");
      const [patientB] = await db("users")
        .insert({
          role: "patient",
          name: "Paciente de B",
          email: `patB-${Date.now()}@test.com`,
          professional_id: profB.id,
          age: 70,
        })
        .returning("*");

      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patientB.id,
        sections: [{ section_id: testSectionId, question_count: 1 }],
      });
      assert.equal(res.status, 404);

      // También si se intenta impersonar a B mediante body:
      const res2 = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patientB.id,
        professional_id: profB.id,
        sections: [{ section_id: testSectionId, question_count: 1 }],
      });
      assert.equal(res2.status, 404);

      await db("users").whereIn("id", [patientB.id, profB.id]).del();
    });

    it("returns 404 for non-existent section", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: 99999, question_count: 1 }],
      });
      assert.equal(res.status, 404);
    });

    it("returns 400 when requesting more questions than available", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 100 }],
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("disponible"));
    });

    it("returns 400 for missing fields", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
      });
      assert.equal(res.status, 400);
    });

    it("does not assign questions with is_validated=false", async () => {
      const [sectionUnvalidated] = await db("sections")
        .insert({
          slug: `test_unvalidated_${Date.now()}`,
          name: "Sección sin validar",
          description: "Solo preguntas no validadas",
    
          is_active: true,
          display_order: 102,
        })
        .returning("*");

      await db("questions").insert({
        section_id: sectionUnvalidated.id,
        prompt: "Pregunta no validada",
        response_type: "multiple_choice",
        options: JSON.stringify(["A", "B", "C"]),
        correct_answer: 0,
        is_active: true,
        is_validated: false,
        source: "test_fixture",
      });

      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: sectionUnvalidated.id, question_count: 1 }],
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("0"));
    });
  });

  describe("GET /api/sessions/:id", () => {
    it("returns a session with sections and questions", async () => {
      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 2 }],
      });
      const sessionId = createRes.body.id;

      const res = await request(app).get(`/api/sessions/${sessionId}`).set("Authorization", profAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.id, sessionId);
      assert.equal(res.body.status, "created");
      assert.equal(res.body.sections.length, 1);
      assert.equal(res.body.sections[0].questions.length, 2);

      const sq = res.body.sections[0].questions[0];
      assert.ok(sq.prompt_snapshot);
      assert.ok(sq.options_snapshot);
      assert.equal(typeof sq.correct_answer_snapshot, "number");
      assert.equal(sq.response_type, "multiple_choice");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app).get("/api/sessions/99999").set("Authorization", profAuth);
      assert.equal(res.status, 404);
    });

    it("returns 400 for invalid session id", async () => {
      const res = await request(app).get("/api/sessions/abc").set("Authorization", profAuth);
      assert.equal(res.status, 400);
    });
  });

  describe("POST /api/sessions/:id/start", () => {
    it("transitions session from created to in_progress (patient owner)", async () => {
      const patientAuth = authHeaderFor(patient);
      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 2 }],
      });
      const sessionId = createRes.body.id;

      const res = await request(app).post(`/api/sessions/${sessionId}/start`).set("Authorization", patientAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "in_progress");
      assert.ok(res.body.started_at);
    });

    it("returns 409 when starting an already started session", async () => {
      const patientAuth = authHeaderFor(patient);
      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 1 }],
      });
      const sessionId = createRes.body.id;

      await request(app).post(`/api/sessions/${sessionId}/start`).set("Authorization", patientAuth);
      const res = await request(app).post(`/api/sessions/${sessionId}/start`).set("Authorization", patientAuth);
      assert.equal(res.status, 409);
    });

    it("returns 404 for non-existent session", async () => {
      const patientAuth = authHeaderFor(patient);
      const res = await request(app).post("/api/sessions/99999/start").set("Authorization", patientAuth);
      assert.equal(res.status, 404);
    });
  });

  describe("Snapshot verification", () => {
    it("snapshots match original question data", async () => {
      const questions = await db("questions")
        .where({ section_id: testSectionId, is_active: true, is_validated: true });

      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 2 }],
      });

      const assignedQuestions = createRes.body.sections[0].questions;
      assert.equal(assignedQuestions.length, 2);

      for (const sq of assignedQuestions) {
        const original = questions.find((q) => q.id === sq.question_id);
        assert.ok(original, `Question ${sq.question_id} should be in eligible pool`);
        assert.equal(sq.prompt_snapshot, original.prompt);
        assert.deepEqual(sq.options_snapshot, original.options);
        assert.equal(sq.correct_answer_snapshot, original.correct_answer);
        assert.equal(sq.response_type, original.response_type);
      }
    });
  });
});
