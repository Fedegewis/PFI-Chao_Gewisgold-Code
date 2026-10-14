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

    // Tras la migración 013, POST /api/patient/sessions ignora question_count
    // del cliente y usa users.max_questions. Estos tests fijaron sus expectativas
    // ANTES de ese cambio; para preservarlas seteamos max_questions=2 por defecto
    // y en cada helper ajustamos según el count solicitado por el test.
    await db("users").where("id", patient.id).update({ max_questions: 2 });
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  // Helper local: fija max_questions del paciente para que la sesión creada
  // por el backend contenga la cantidad esperada por el test.
  async function setPatientMaxQuestions(n) {
    await db("users").where("id", patient.id).update({ max_questions: n });
  }

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

  it("mood: persiste patient_reported_mood válido pasado por el cliente", async () => {
    await setPatientMaxQuestions(2);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }], patient_reported_mood: "bien" });
    assert.equal(res.status, 201);
    const row = await db("sessions").where({ id: res.body.id }).first();
    assert.equal(row.patient_reported_mood, "bien");
  });

  it("mood: sin patient_reported_mood → NULL en DB", async () => {
    await setPatientMaxQuestions(2);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }] });
    assert.equal(res.status, 201);
    const row = await db("sessions").where({ id: res.body.id }).first();
    assert.equal(row.patient_reported_mood, null);
  });

  it("mood: patient_reported_mood=null explícito → NULL en DB", async () => {
    await setPatientMaxQuestions(2);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }], patient_reported_mood: null });
    assert.equal(res.status, 201);
    const row = await db("sessions").where({ id: res.body.id }).first();
    assert.equal(row.patient_reported_mood, null);
  });

  it("mood: valor inválido → 400", async () => {
    await setPatientMaxQuestions(2);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }], patient_reported_mood: "furia" });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /patient_reported_mood/i);
  });

  it("mood: una vez snapshot, no se altera retroactivamente al mutar user state", async () => {
    await setPatientMaxQuestions(2);
    const create = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }], patient_reported_mood: "cansancio" });
    const sessionId = create.body.id;
    // Un segundo POST con otro mood crea una sesión distinta — no debe
    // modificar la primera.
    await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }], patient_reported_mood: "bien" });
    const row = await db("sessions").where({ id: sessionId }).first();
    assert.equal(row.patient_reported_mood, "cansancio");
  });

  it("mood: GET /api/patients/:id/sessions devuelve patient_reported_mood", async () => {
    await setPatientMaxQuestions(2);
    const create = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId }], patient_reported_mood: "calma" });
    const res = await request(app)
      .get(`/api/patients/${patient.id}/sessions`)
      .set("Authorization", profAuth);
    assert.equal(res.status, 200);
    const row = res.body.find((r) => r.id === create.body.id);
    assert.ok(row, "falta la sesión recién creada");
    assert.equal(row.patient_reported_mood, "calma");
  });

  it("ignora question_count enviado por el cliente y usa max_questions persistido", async () => {
    // Nuevo contrato (migración 013): el backend resuelve cantidad desde la
    // configuración del paciente; cualquier question_count del body se ignora.
    await setPatientMaxQuestions(2);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientAuth)
      .send({ sections: [{ section_id: testSectionId, question_count: 0 }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.sections[0].questions.length, 2);
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

  describe("GET /api/patients/:patientId/sessions — 6D.5", () => {
    async function createAndCompleteSession(patientAuthLocal) {
      await setPatientMaxQuestions(1);
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuthLocal)
        .send({ sections: [{ section_id: testSectionId }] });
      const s = create.body;
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuthLocal);
      await request(app)
        .post(`/api/sessions/${s.id}/answers`)
        .set("Authorization", patientAuthLocal)
        .send({ session_question_id: s.sections[0].questions[0].id, selected_answer: 0, response_time_ms: 1500 });
      await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", patientAuthLocal);
      return s;
    }

    async function createAndAbandonSession(patientAuthLocal) {
      await setPatientMaxQuestions(1);
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuthLocal)
        .send({ sections: [{ section_id: testSectionId }] });
      const s = create.body;
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuthLocal);
      await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", patientAuthLocal);
      return s;
    }

    it("professional owner obtiene sesiones del paciente ordenadas por created_at desc", async () => {
      const completedS = await createAndCompleteSession(patientAuth);
      const abandonedS = await createAndAbandonSession(patientAuth);
      const res = await request(app)
        .get(`/api/patients/${patient.id}/sessions`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      const ids = res.body.map((r) => r.id);
      const idxCompleted = ids.indexOf(completedS.id);
      const idxAbandoned = ids.indexOf(abandonedS.id);
      assert.ok(idxAbandoned >= 0);
      assert.ok(idxCompleted >= 0);
      // abandoned se creó después, debe venir primero
      assert.ok(idxAbandoned < idxCompleted);
    });

    it("incluye summary para completed y no lo incluye para abandoned", async () => {
      const completedS = await createAndCompleteSession(patientAuth);
      const abandonedS = await createAndAbandonSession(patientAuth);
      const res = await request(app)
        .get(`/api/patients/${patient.id}/sessions`)
        .set("Authorization", profAuth);
      const c = res.body.find((r) => r.id === completedS.id);
      const a = res.body.find((r) => r.id === abandonedS.id);
      assert.ok(c.summary);
      assert.equal(c.summary.total_questions, 1);
      assert.equal(c.summary.correct_count, 1);
      assert.equal(c.summary.accuracy, 1);
      assert.equal(a.summary, undefined);
    });

    it("no expone correct_answer_snapshot ni answers individuales", async () => {
      await createAndCompleteSession(patientAuth);
      const res = await request(app)
        .get(`/api/patients/${patient.id}/sessions`)
        .set("Authorization", profAuth);
      const serialized = JSON.stringify(res.body);
      assert.equal(serialized.includes("correct_answer"), false);
      assert.equal(serialized.includes("answers"), false);
      assert.equal(serialized.includes("password"), false);
    });

    it("otro professional no puede leer sesiones ajenas (404)", async () => {
      const [otherProf] = await db("users")
        .insert({
          role: "professional",
          name: "Prof Ajeno Sess",
          email: `other-prof-sess-${Date.now()}${EMAIL_SUFFIX}`,
        })
        .returning("*");
      const res = await request(app)
        .get(`/api/patients/${patient.id}/sessions`)
        .set("Authorization", authHeaderFor(otherProf));
      assert.equal(res.status, 404);
    });

    it("patient no puede usar el endpoint profesional (403)", async () => {
      const res = await request(app)
        .get(`/api/patients/${patient.id}/sessions`)
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
    });

    it("sin auth → 401", async () => {
      const res = await request(app).get(`/api/patients/${patient.id}/sessions`);
      assert.equal(res.status, 401);
    });

    it("paciente inexistente → 404", async () => {
      const res = await request(app)
        .get(`/api/patients/9999999/sessions`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 404);
    });

    it("paciente sin sesiones devuelve []", async () => {
      const [freshPatient] = await db("users")
        .insert({
          role: "patient",
          name: "Fresh",
          email: `fresh-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      const res = await request(app)
        .get(`/api/patients/${freshPatient.id}/sessions`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
    });
  });

  describe("POST /api/sessions/:id/complete — 6D.4", () => {
    async function createStartedSession(count = 2) {
      await setPatientMaxQuestions(count);
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId }] });
      const s = create.body;
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      return s;
    }

    async function answerAll(s) {
      for (const q of s.sections[0].questions) {
        await request(app)
          .post(`/api/sessions/${s.id}/answers`)
          .set("Authorization", patientAuth)
          .send({ session_question_id: q.id, selected_answer: 0, response_time_ms: 1500 });
      }
    }

    it("patient owner completa con todas las respuestas → 200; session_results creado", async () => {
      const s = await createStartedSession(2);
      await answerAll(s);
      const res = await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", patientAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "completed");
      assert.ok(res.body.completed_at);
      assert.ok(res.body.global);
      assert.equal(res.body.global.total_questions, 2);

      const sessionRow = await db("sessions").where({ id: s.id }).first();
      assert.equal(sessionRow.status, "completed");
      assert.ok(sessionRow.completed_at);
      const results = await db("session_results").where({ session_id: s.id });
      assert.ok(results.length >= 2, "at least global + 1 section");
    });

    it("body malicioso con score/is_correct/patient_id es ignorado", async () => {
      const s = await createStartedSession(1);
      await answerAll(s);
      const res = await request(app)
        .post(`/api/sessions/${s.id}/complete`)
        .set("Authorization", patientAuth)
        .send({ accuracy: 999, correct_count: 999, patient_id: 9999999, professional_id: 8888888, score: 100 });
      assert.equal(res.status, 200);
      const gr = await db("session_results")
        .where({ session_id: s.id })
        .whereNull("section_id")
        .first();
      assert.notEqual(Number(gr.correct_count), 999);
    });

    it("faltan answers → 409 y session no queda completed", async () => {
      const s = await createStartedSession(2);
      // sólo responde una
      await request(app)
        .post(`/api/sessions/${s.id}/answers`)
        .set("Authorization", patientAuth)
        .send({ session_question_id: s.sections[0].questions[0].id, selected_answer: 0, response_time_ms: 1000 });
      const res = await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", patientAuth);
      assert.equal(res.status, 409);
      assert.equal(res.body.status, "missing_answers");
      const row = await db("sessions").where({ id: s.id }).first();
      assert.equal(row.status, "in_progress");
      const results = await db("session_results").where({ session_id: s.id });
      assert.equal(results.length, 0);
    });

    it("patient ajeno → 404", async () => {
      const s = await createStartedSession(1);
      await answerAll(s);
      const [other] = await db("users")
        .insert({
          role: "patient",
          name: "Otro Comp",
          email: `other-comp-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      const res = await request(app)
        .post(`/api/sessions/${s.id}/complete`)
        .set("Authorization", authHeaderFor(other));
      assert.equal(res.status, 404);
    });

    it("professional → 403", async () => {
      const s = await createStartedSession(1);
      await answerAll(s);
      const res = await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", profAuth);
      assert.equal(res.status, 403);
    });

    it("sin auth → 401", async () => {
      const s = await createStartedSession(1);
      await answerAll(s);
      const res = await request(app).post(`/api/sessions/${s.id}/complete`);
      assert.equal(res.status, 401);
    });

    it("doble complete no duplica session_results", async () => {
      const s = await createStartedSession(1);
      await answerAll(s);
      const first = await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", patientAuth);
      assert.equal(first.status, 200);
      const second = await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", patientAuth);
      assert.equal(second.status, 409);

      const globals = await db("session_results").where({ session_id: s.id }).whereNull("section_id");
      assert.equal(globals.length, 1);
    });
  });

  describe("POST /api/sessions/:id/abandon — 6D.4", () => {
    async function createSession() {
      const create = await request(app)
        .post("/api/patient/sessions")
        .set("Authorization", patientAuth)
        .send({ sections: [{ section_id: testSectionId, question_count: 1 }] });
      return create.body;
    }

    it("owner puede abandonar created", async () => {
      const s = await createSession();
      const res = await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", patientAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "abandoned");
      assert.ok(res.body.abandoned_at);
    });

    it("owner puede abandonar in_progress", async () => {
      const s = await createSession();
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      const res = await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", patientAuth);
      assert.equal(res.status, 200);
    });

    it("completed no puede abandonarse (409)", async () => {
      const s = await createSession();
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      await request(app)
        .post(`/api/sessions/${s.id}/answers`)
        .set("Authorization", patientAuth)
        .send({ session_question_id: s.sections[0].questions[0].id, selected_answer: 0, response_time_ms: 1000 });
      await request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", patientAuth);
      const res = await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", patientAuth);
      assert.equal(res.status, 409);
    });

    it("ajeno → 404", async () => {
      const s = await createSession();
      const [other] = await db("users")
        .insert({
          role: "patient",
          name: "Otro Ab",
          email: `other-ab-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: professional.id,
        })
        .returning("*");
      const res = await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", authHeaderFor(other));
      assert.equal(res.status, 404);
    });

    it("professional → 403", async () => {
      const s = await createSession();
      const res = await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", profAuth);
      assert.equal(res.status, 403);
    });

    it("sin auth → 401", async () => {
      const s = await createSession();
      const res = await request(app).post(`/api/sessions/${s.id}/abandon`);
      assert.equal(res.status, 401);
    });

    it("no genera session_results", async () => {
      const s = await createSession();
      await request(app).post(`/api/sessions/${s.id}/start`).set("Authorization", patientAuth);
      await request(app).post(`/api/sessions/${s.id}/abandon`).set("Authorization", patientAuth);
      const results = await db("session_results").where({ session_id: s.id });
      assert.equal(results.length, 0);
    });
  });

});
