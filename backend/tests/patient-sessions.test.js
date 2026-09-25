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
});
