import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@patient-sessions-test.com";

async function cleanTestData() {
  const emails = await db("users")
    .where("email", "like", `%${EMAIL_SUFFIX}`)
    .pluck("id");
  if (emails.length > 0) {
    const sessionIds = await db("sessions").whereIn("patient_id", emails).pluck("id");
    if (sessionIds.length > 0) {
      const sectionIds = await db("session_sections").whereIn("session_id", sessionIds).pluck("id");
      if (sectionIds.length > 0) {
        await db("session_questions").whereIn("session_section_id", sectionIds).del();
      }
      await db("session_sections").whereIn("session_id", sessionIds).del();
      await db("sessions").whereIn("id", sessionIds).del();
    }
  }
  await db("questions").where("source", "6d1_test_fixture").del();
  await db("sections").where("slug", "like", "6d1_test_%").del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Patient Sessions API — POST /api/patient/sessions", () => {
  let professional;
  let patient;
  let patientWithoutProf;
  let inactivePatient;
  let profAuth;
  let patientAuth;
  let orphanAuth;
  let inactiveAuth;
  let testSectionId;

  before(async () => {
    await cleanTestData();

    [professional] = await db("users")
      .insert({
        role: "professional",
        name: "Prof Sess",
        email: `prof-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");

    [patient] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente Sess",
        email: `pat-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: professional.id,
      })
      .returning("*");

    [patientWithoutProf] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente Huérfano",
        email: `orphan-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");

    [inactivePatient] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente Inactivo",
        email: `inactive-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: professional.id,
        is_active: false,
      })
      .returning("*");

    profAuth = authHeaderFor(professional);
    patientAuth = authHeaderFor(patient);
    orphanAuth = authHeaderFor(patientWithoutProf);
    inactiveAuth = authHeaderFor(inactivePatient);

    const [section] = await db("sections")
      .insert({
        slug: `6d1_test_${Date.now()}`,
        name: "Sección de test 6D.1",
        description: "Sección aislada para tests de patient sessions",
        is_active: true,
        display_order: 200,
      })
      .returning("*");
    testSectionId = section.id;

    const questionsToInsert = [];
    for (let i = 0; i < 5; i++) {
      questionsToInsert.push({
        section_id: testSectionId,
        prompt: `Pregunta 6D.1 test ${i + 1}`,
        response_type: "multiple_choice",
        options: JSON.stringify(["A", "B", "C", "D"]),
        correct_answer: 0,
        is_active: true,
        is_validated: true,
        source: "6d1_test_fixture",
      });
    }
    await db("questions").insert(questionsToInsert);
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  it("patient creates own session; patient_id and professional_id come from server context", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 2 }] });

    assert.equal(res.status, 201);
    assert.equal(res.body.patient_id, patient.id);
    assert.equal(res.body.professional_id, professional.id);
    assert.equal(res.body.status, "created");
    assert.ok(Array.isArray(res.body.sections));
    assert.equal(res.body.sections.length, 1);
    assert.equal(res.body.sections[0].section_id, testSectionId);
    assert.equal(res.body.sections[0].questions.length, 2);

    const dbSession = await db("sessions").where({ id: res.body.id }).first();
    assert.equal(dbSession.patient_id, patient.id);
    assert.equal(dbSession.professional_id, professional.id);
  });

  it("ignores patient_id and professional_id sent in body", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({
        patient_id: 9999999,
        professional_id: 8888888,
        role: "professional",
        sections: [{ section_id: testSectionId, question_count: 1 }],
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.patient_id, patient.id);
    assert.equal(res.body.professional_id, professional.id);
  });

  it("accepts section_slug in addition to section_id", async () => {
    const section = await db("sections").where("id", testSectionId).first();
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_slug: section.slug, question_count: 1 }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.sections[0].section_id, testSectionId);
  });

  it("rejects professional tokens with 403", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", profAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
    assert.equal(res.status, 403);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
    assert.equal(res.status, 401);
  });

  it("returns 400 when the patient has no professional_id", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", orphanAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /profesional/i);
  });

  it("rejects an inactive patient (requireAuth blocks by is_active)", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", inactiveAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
    assert.equal(res.status, 401);
  });

  it("returns 400 for empty or missing sections", async () => {
    let res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({});
    assert.equal(res.status, 400);

    res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [] });
    assert.equal(res.status, 400);
  });

  it("returns 400 for invalid question_count", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 0 }] });
    assert.equal(res.status, 400);
  });

  it("returns 404 for a non-existent section", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: 9999999, question_count: 1 }] });
    assert.equal(res.status, 404);
  });

  it("never exposes correct_answer_snapshot in the response", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 3 }] });
    assert.equal(res.status, 201);
    for (const sq of res.body.sections[0].questions) {
      assert.equal(sq.correct_answer_snapshot, undefined);
      assert.equal(JSON.stringify(sq).includes("correct_answer"), false);
    }
  });

  it("includes prompt/options/stimulus/response_type and respects display_order", async () => {
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 3 }] });
    assert.equal(res.status, 201);
    const qs = res.body.sections[0].questions;
    for (const sq of qs) {
      assert.ok(sq.prompt_snapshot);
      assert.ok(sq.options_snapshot);
      assert.equal(sq.response_type, "multiple_choice");
      assert.equal("stimulus_snapshot" in sq, true);
    }
    const orders = qs.map((q) => q.display_order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  });

  describe("GET /api/sessions/:id — ownership + sanitization", () => {
    let sessionOfPatient;

    before(async () => {
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 2 }] });
      sessionOfPatient = create.body;
    });

    it("patient owner can read the session; correct_answer never exposed", async () => {
      const res = await request(app)
        .get(`/api/sessions/${sessionOfPatient.id}`)
        .set("Authorization", patientAuth);
      assert.equal(res.status, 200);
      for (const sq of res.body.sections[0].questions) {
        assert.equal(sq.correct_answer_snapshot, undefined);
      }
    });

    it("another patient cannot read the session (404)", async () => {
      const [otherPatient] = await db("users")
        .insert({
          role: "patient",
          name: "Otro Paciente",
          email: `other-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      const otherAuth = authHeaderFor(otherPatient);
      const res = await request(app)
        .get(`/api/sessions/${sessionOfPatient.id}`)
        .set("Authorization", otherAuth);
      assert.equal(res.status, 404);
    });

    it("professional owner can read the session AND sees correct_answer_snapshot", async () => {
      const res = await request(app)
        .get(`/api/sessions/${sessionOfPatient.id}`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 200);
      const sq = res.body.sections[0].questions[0];
      assert.equal(typeof sq.correct_answer_snapshot, "number");
    });

    it("another professional cannot read the session (404)", async () => {
      const [otherProf] = await db("users")
        .insert({
          role: "professional",
          name: "Otro Prof",
          email: `other-prof-${Date.now()}${EMAIL_SUFFIX}`,
        })
        .returning("*");
      const otherAuth = authHeaderFor(otherProf);
      const res = await request(app)
        .get(`/api/sessions/${sessionOfPatient.id}`)
        .set("Authorization", otherAuth);
      assert.equal(res.status, 404);
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).get(`/api/sessions/${sessionOfPatient.id}`);
      assert.equal(res.status, 401);
    });

    it("returns 404 for a non-existent session", async () => {
      const res = await request(app)
        .get(`/api/sessions/9999999`)
        .set("Authorization", patientAuth);
      assert.equal(res.status, 404);
    });
  });

  describe("POST /api/sessions/:id/start — ownership + idempotencia (6D.3)", () => {
    async function createOwnedSession() {
      const res = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
      return res.body;
    }

    it("patient owner puede iniciar su sesión", async () => {
      const s = await createOwnedSession();
      const res = await request(app)
        .post(`/api/sessions/${s.id}/start`)
        .set("Authorization", patientAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "in_progress");
      assert.ok(res.body.started_at);
    });

    it("start dos veces devuelve 409 con el estado actual", async () => {
      const s = await createOwnedSession();
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      const res = await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      assert.equal(res.status, 409);
      assert.equal(res.body.status, "in_progress");
    });

    it("patient ajeno no puede iniciar sesión (404)", async () => {
      const s = await createOwnedSession();
      const [other] = await db("users")
        .insert({
          role: "patient",
          name: "Otro Start",
          email: `start-other-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      const res = await request(app)
        .post(`/api/sessions/${s.id}/start`)
        .set("Authorization", authHeaderFor(other));
      assert.equal(res.status, 404);
    });

    it("professional no puede iniciar sesión por este flujo (403)", async () => {
      const s = await createOwnedSession();
      const res = await request(app)
        .post(`/api/sessions/${s.id}/start`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 403);
    });

    it("sin auth → 401", async () => {
      const s = await createOwnedSession();
      const res = await request(app).post(`/api/sessions/${s.id}/start`);
      assert.equal(res.status, 401);
    });
  });

  describe("POST /api/sessions/:id/answers — ownership + is_correct server-side (6D.3)", () => {
    let session;
    let sqId;

    before(async () => {
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 2 }] });
      session = create.body;
      sqId = session.sections[0].questions[0].id;
      await request(app).post(`/api/sessions/${session.id}/start`).set("Authorization", patientAuth);
    });

    it("patient owner puede responder pregunta propia; is_correct NO se expone", async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .set("Authorization", patientAuth)
        .send({ session_question_id: sqId, selected_answer: 0, response_time_ms: 1500 });
      assert.equal(res.status, 201);
      assert.equal(res.body.is_correct, undefined);
      assert.equal(res.body.correct_answer_snapshot, undefined);
      assert.equal(res.body.selected_answer, 0);
      assert.equal(res.body.response_time_ms, 1500);
      // is_correct sí queda persistido server-side
      const row = await db("answers").where({ session_question_id: sqId }).first();
      assert.equal(row.is_correct, true);
    });

    it("ignora patient_id/professional_id/is_correct/correct_answer del body", async () => {
      const sqId2 = session.sections[0].questions[1].id;
      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .set("Authorization", patientAuth)
        .send({
          session_question_id: sqId2,
          selected_answer: 2,
          response_time_ms: 2000,
          patient_id: 9999999,
          professional_id: 8888888,
          is_correct: true,
          correct_answer: 2,
        });
      assert.equal(res.status, 201);
      const row = await db("answers").where({ session_question_id: sqId2 }).first();
      assert.equal(row.selected_answer, 2);
      // El correct_answer real de la fixture es 0, así que is_correct debe ser false
      assert.equal(row.is_correct, false);
    });

    it("respuesta duplicada devuelve 409", async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .set("Authorization", patientAuth)
        .send({ session_question_id: sqId, selected_answer: 1, response_time_ms: 1000 });
      assert.equal(res.status, 409);
    });

    it("patient ajeno no puede responder pregunta de otra sesión (404)", async () => {
      const [other] = await db("users")
        .insert({
          role: "patient",
          name: "Otro Ans",
          email: `ans-other-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .set("Authorization", authHeaderFor(other))
        .send({ session_question_id: sqId, selected_answer: 0, response_time_ms: 1500 });
      assert.equal(res.status, 404);
    });

    it("patient no puede responder pregunta que no pertenece a su sesión (404)", async () => {
      const create2 = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
      const foreignSqId = create2.body.sections[0].questions[0].id;
      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .set("Authorization", patientAuth)
        .send({ session_question_id: foreignSqId, selected_answer: 0, response_time_ms: 1500 });
      assert.equal(res.status, 404);
    });

    it("professional no puede responder por este flujo (403)", async () => {
      const create3 = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
      const s3 = create3.body;
      await request(app).post(`/api/sessions/${s3.id}/start`).set("Authorization", patientAuth);
      const res = await request(app)
        .post(`/api/sessions/${s3.id}/answers`)
        .set("Authorization", profAuth)
        .send({ session_question_id: s3.sections[0].questions[0].id, selected_answer: 0, response_time_ms: 1000 });
      assert.equal(res.status, 403);
    });

    it("sin auth → 401", async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .send({ session_question_id: sqId, selected_answer: 0, response_time_ms: 1500 });
      assert.equal(res.status, 401);
    });

    it("response_time_ms fuera de rango → 400", async () => {
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
      const s = create.body;
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      const sq = s.sections[0].questions[0].id;

      for (const bad of [0, -1, "abc", 1.5, 60 * 60 * 1000]) {
        const res = await request(app)
          .post(`/api/sessions/${s.id}/answers`)
          .set("Authorization", patientAuth)
          .send({ session_question_id: sq, selected_answer: 0, response_time_ms: bad });
        assert.equal(res.status, 400);
      }
    });
  });
});
