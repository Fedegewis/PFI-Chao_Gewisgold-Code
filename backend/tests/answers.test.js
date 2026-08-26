import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";

let professional;
let patient;
let testSectionId1;
let testSectionId2;

async function cleanTestData() {
  await db("answers")
    .whereIn("session_question_id", db("session_questions").select("id"))
    .del();
  await db("session_results")
    .whereIn("session_id", db("sessions").select("id"))
    .del();
  await db("session_questions")
    .whereIn(
      "session_section_id",
      db("session_sections")
        .select("id")
        .whereIn("session_id", db("sessions").select("id"))
    )
    .del();
  await db("session_sections")
    .whereIn("session_id", db("sessions").select("id"))
    .del();
  await db("sessions").del();
  await db("questions").where("source", "test_fixture").del();
  await db("sections").where("cognitive_domain", "Test").del();
  await db("users").where("email", "like", "%@test.com").del();
}

async function createTestFixtures() {
  await cleanTestData();

  [professional] = await db("users")
    .insert({
      role: "professional",
      name: "Dr. Test",
      email: `prof-${Date.now()}@test.com`,
    })
    .returning("*");

  [patient] = await db("users")
    .insert({
      role: "patient",
      name: "Paciente Test",
      email: `patient-${Date.now()}@test.com`,
      age: 72,
      professional_id: professional.id,
    })
    .returning("*");

  const [section1] = await db("sections")
    .insert({
      slug: `test_ans_s1_${Date.now()}`,
      name: "Sección Answers 1",
      description: "Primera sección para tests de answers",
      cognitive_domain: "Test",
      is_active: true,
      display_order: 200,
    })
    .returning("*");
  testSectionId1 = section1.id;

  const [section2] = await db("sections")
    .insert({
      slug: `test_ans_s2_${Date.now()}`,
      name: "Sección Answers 2",
      description: "Segunda sección para tests de answers",
      cognitive_domain: "Test",
      is_active: true,
      display_order: 201,
    })
    .returning("*");
  testSectionId2 = section2.id;

  const s1Questions = [];
  for (let i = 0; i < 3; i++) {
    s1Questions.push({
      section_id: testSectionId1,
      prompt: `Pregunta S1-${i + 1}`,
      response_type: "multiple_choice",
      options: JSON.stringify(["Opción A", "Opción B", "Opción C"]),
      correct_answer: 0,
      is_active: true,
      is_validated: true,
      source: "test_fixture",
    });
  }
  await db("questions").insert(s1Questions);

  const s2Questions = [];
  for (let i = 0; i < 2; i++) {
    s2Questions.push({
      section_id: testSectionId2,
      prompt: `Pregunta S2-${i + 1}`,
      response_type: "multiple_choice",
      options: JSON.stringify(["Opción A", "Opción B", "Opción C"]),
      correct_answer: 0,
      is_active: true,
      is_validated: true,
      source: "test_fixture",
    });
  }
  await db("questions").insert(s2Questions);
}

async function createSession(sections) {
  const res = await request(app).post("/api/sessions").send({
    patient_id: patient.id,
    professional_id: professional.id,
    sections,
  });
  return res.body;
}

async function startSession(sessionId) {
  await request(app).post(`/api/sessions/${sessionId}/start`);
}

async function answerQuestion(
  sessionId,
  sessionQuestionId,
  selectedAnswer,
  responseTimeMs = 2000
) {
  return request(app)
    .post(`/api/sessions/${sessionId}/answers`)
    .send({
      session_question_id: sessionQuestionId,
      selected_answer: selectedAnswer,
      response_time_ms: responseTimeMs,
    });
}

function assertApprox(actual, expected, tolerance = 0.02) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ~${expected} ± ${tolerance}, got ${actual}`
  );
}

describe("Answers & Results API", () => {
  before(async () => {
    await createTestFixtures();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("POST /api/sessions/:id/answers", () => {
    it("registers a correct answer with is_correct=true", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      const sqId = session.sections[0].questions[0].id;

      const res = await answerQuestion(session.id, sqId, 0, 1500);
      assert.equal(res.status, 201);
      assert.equal(res.body.session_question_id, sqId);
      assert.equal(res.body.selected_answer, 0);
      assert.equal(res.body.is_correct, true);
      assert.equal(res.body.response_time_ms, 1500);
      assert.ok(res.body.id);
      assert.ok(res.body.answered_at);
    });

    it("registers an incorrect answer with is_correct=false", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      const sqId = session.sections[0].questions[0].id;

      const res = await answerQuestion(session.id, sqId, 1, 2000);
      assert.equal(res.status, 201);
      assert.equal(res.body.is_correct, false);
      assert.equal(res.body.selected_answer, 1);
    });

    it("returns 400 for invalid selected_answer", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      const sqId = session.sections[0].questions[0].id;

      const outOfBounds = await answerQuestion(session.id, sqId, 5, 1000);
      assert.equal(outOfBounds.status, 400);

      const negative = await answerQuestion(session.id, sqId, -1, 1000);
      assert.equal(negative.status, 400);
    });

    it("returns 400 for invalid response_time_ms", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      const sqId = session.sections[0].questions[0].id;

      const zero = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .send({ session_question_id: sqId, selected_answer: 0, response_time_ms: 0 });
      assert.equal(zero.status, 400);

      const negative = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .send({ session_question_id: sqId, selected_answer: 0, response_time_ms: -100 });
      assert.equal(negative.status, 400);

      const decimal = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .send({ session_question_id: sqId, selected_answer: 0, response_time_ms: 1.5 });
      assert.equal(decimal.status, 400);
    });

    it("returns 400 for missing required fields", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/answers`)
        .send({ session_question_id: 1 });
      assert.equal(res.status, 400);
    });

    it("returns 404 for nonexistent session_question", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);

      const res = await answerQuestion(session.id, 99999, 0);
      assert.equal(res.status, 404);
    });

    it("returns 404 for session_question from another session", async () => {
      const s1 = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      const s2 = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(s1.id);

      const s2QuestionId = s2.sections[0].questions[0].id;
      const res = await answerQuestion(s1.id, s2QuestionId, 0);
      assert.equal(res.status, 404);
    });

    it("returns 400 when session is in created state", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      const sqId = session.sections[0].questions[0].id;

      const res = await answerQuestion(session.id, sqId, 0);
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("created"));
    });

    it("returns 409 for duplicate answer", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      const sqId = session.sections[0].questions[0].id;

      await answerQuestion(session.id, sqId, 0);
      const res = await answerQuestion(session.id, sqId, 1);
      assert.equal(res.status, 409);
    });

    it("returns 400 when session is completed", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/complete`);

      const sqId = session.sections[0].questions[0].id;
      const res = await answerQuestion(session.id, sqId, 0);
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("completed"));
    });

    it("returns 400 when session is abandoned", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/abandon`);

      const sqId = session.sections[0].questions[0].id;
      const res = await answerQuestion(session.id, sqId, 0);
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("abandoned"));
    });
  });

  describe("POST /api/sessions/:id/complete", () => {
    it("completes a fully answered session", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 2 },
      ]);
      await startSession(session.id);

      for (const sq of session.sections[0].questions) {
        await answerQuestion(session.id, sq.id, 0);
      }

      const res = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "completed");
      assert.ok(res.body.completed_at);
    });

    it("completes a partially answered session", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 3 },
      ]);
      await startSession(session.id);
      await answerQuestion(session.id, session.sections[0].questions[0].id, 0);

      const res = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "completed");
    });

    it("completes a session with zero answers", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);

      const res = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "completed");
    });

    it("returns 400 for double complete", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/complete`);

      const res = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("completed"));
    });

    it("returns 400 for completing abandoned session", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/abandon`);

      const res = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(res.status, 400);
    });

    it("returns 400 for completing session in created state", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);

      const res = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("created"));
    });
  });

  describe("POST /api/sessions/:id/abandon", () => {
    it("abandons from created state", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);

      const res = await request(app).post(
        `/api/sessions/${session.id}/abandon`
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "abandoned");
      assert.ok(res.body.abandoned_at);
      assert.equal(res.body.completed_at, null);
    });

    it("abandons from in_progress preserving answers", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 2 },
      ]);
      await startSession(session.id);
      const sqId = session.sections[0].questions[0].id;
      await answerQuestion(session.id, sqId, 0, 1500);

      const res = await request(app).post(
        `/api/sessions/${session.id}/abandon`
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "abandoned");
      assert.ok(res.body.abandoned_at);

      const answers = await db("answers")
        .where("session_question_id", sqId)
        .select("*");
      assert.equal(answers.length, 1);
      assert.equal(answers[0].is_correct, true);
    });

    it("prevents answering and completing after abandon", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/abandon`);

      const sqId = session.sections[0].questions[0].id;
      const answerRes = await answerQuestion(session.id, sqId, 0);
      assert.equal(answerRes.status, 400);

      const completeRes = await request(app).post(
        `/api/sessions/${session.id}/complete`
      );
      assert.equal(completeRes.status, 400);
    });

    it("returns 400 for double abandon", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await request(app).post(`/api/sessions/${session.id}/abandon`);

      const res = await request(app).post(
        `/api/sessions/${session.id}/abandon`
      );
      assert.equal(res.status, 400);
    });
  });

  describe("GET /api/sessions/:id/results", () => {
    it("returns structured results for completed session", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 2 },
      ]);
      await startSession(session.id);
      for (const sq of session.sections[0].questions) {
        await answerQuestion(session.id, sq.id, 0, 2000);
      }
      await request(app).post(`/api/sessions/${session.id}/complete`);

      const res = await request(app).get(
        `/api/sessions/${session.id}/results`
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.session_id, session.id);
      assert.equal(res.body.status, "completed");
      assert.ok(res.body.started_at);
      assert.ok(res.body.completed_at);
      assert.ok(res.body.global);
      assert.ok(Array.isArray(res.body.sections));
      assert.equal(res.body.sections.length, 1);
      assert.ok(res.body.sections[0].section_name);
      assert.ok(res.body.sections[0].section_slug);
    });

    it("returns 404 for nonexistent session", async () => {
      const res = await request(app).get("/api/sessions/99999/results");
      assert.equal(res.status, 404);
    });

    it("returns 400 for non-completed session", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);

      const res = await request(app).get(
        `/api/sessions/${session.id}/results`
      );
      assert.equal(res.status, 400);
    });
  });

  describe("Metrics calculation", () => {
    it("calculates correct per-section and global metrics with weighted accuracy", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 3 },
        { section_id: testSectionId2, question_count: 2 },
      ]);
      await startSession(session.id);

      const s1Qs = session.sections[0].questions;
      await answerQuestion(session.id, s1Qs[0].id, 0, 1000);
      await answerQuestion(session.id, s1Qs[1].id, 1, 2000);
      await answerQuestion(session.id, s1Qs[2].id, 0, 3000);

      const s2Qs = session.sections[1].questions;
      await answerQuestion(session.id, s2Qs[0].id, 0, 1500);

      await request(app).post(`/api/sessions/${session.id}/complete`);

      const res = await request(app).get(
        `/api/sessions/${session.id}/results`
      );
      assert.equal(res.status, 200);

      const s1 = res.body.sections[0];
      assert.equal(s1.total_questions, 3);
      assert.equal(s1.answered_questions, 3);
      assert.equal(s1.correct_count, 2);
      assert.equal(s1.incorrect_count, 1);
      assert.equal(s1.unanswered_count, 0);
      assertApprox(s1.accuracy, 2 / 3);
      assert.equal(s1.completion_rate, 1);
      assert.equal(s1.mean_latency_ms, 2000);
      assert.equal(s1.min_latency_ms, 1000);
      assert.equal(s1.max_latency_ms, 3000);
      assert.ok(s1.latency_std_ms > 0);

      const s2 = res.body.sections[1];
      assert.equal(s2.total_questions, 2);
      assert.equal(s2.answered_questions, 1);
      assert.equal(s2.correct_count, 1);
      assert.equal(s2.incorrect_count, 0);
      assert.equal(s2.unanswered_count, 1);
      assert.equal(s2.accuracy, 1);
      assert.equal(s2.completion_rate, 0.5);
      assert.equal(s2.mean_latency_ms, 1500);
      assert.equal(s2.min_latency_ms, 1500);
      assert.equal(s2.max_latency_ms, 1500);
      assert.equal(s2.latency_std_ms, 0);

      const g = res.body.global;
      assert.equal(g.total_questions, 5);
      assert.equal(g.answered_questions, 4);
      assert.equal(g.correct_count, 3);
      assert.equal(g.incorrect_count, 1);
      assert.equal(g.unanswered_count, 1);
      assert.equal(g.accuracy, 0.75);
      assert.equal(g.completion_rate, 0.8);

      assert.notEqual(g.accuracy, (2 / 3 + 1) / 2);

      assert.equal(g.mean_latency_ms, 1875);
      assert.equal(g.min_latency_ms, 1000);
      assert.equal(g.max_latency_ms, 3000);

      const expectedGlobalStd = Math.sqrt(
        ([1000, 2000, 3000, 1500].reduce(
          (s, v) => s + (v - 1875) ** 2,
          0
        )) / 4
      );
      assertApprox(g.latency_std_ms, expectedGlobalStd, 0.1);

      const s1Std = Math.sqrt(
        ([1000, 2000, 3000].reduce((s, v) => s + (v - 2000) ** 2, 0)) / 3
      );
      assertApprox(s1.latency_std_ms, s1Std, 0.1);
    });

    it("accuracy is NULL when no answers exist", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/complete`);

      const res = await request(app).get(
        `/api/sessions/${session.id}/results`
      );
      assert.equal(res.body.global.accuracy, null);
      assert.equal(res.body.global.completion_rate, 0);
      assert.equal(res.body.global.unanswered_count, 1);
    });

    it("latency metrics are NULL when no answers exist", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/complete`);

      const res = await request(app).get(
        `/api/sessions/${session.id}/results`
      );
      assert.equal(res.body.global.mean_latency_ms, null);
      assert.equal(res.body.global.min_latency_ms, null);
      assert.equal(res.body.global.max_latency_ms, null);
      assert.equal(res.body.global.latency_std_ms, null);
    });

    it("latency_std_ms is 0 with single answer", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 2 },
      ]);
      await startSession(session.id);
      await answerQuestion(
        session.id,
        session.sections[0].questions[0].id,
        0,
        5000
      );
      await request(app).post(`/api/sessions/${session.id}/complete`);

      const res = await request(app).get(
        `/api/sessions/${session.id}/results`
      );
      assert.equal(res.body.global.latency_std_ms, 0);
      assert.equal(res.body.global.mean_latency_ms, 5000);
      assert.equal(res.body.global.min_latency_ms, 5000);
      assert.equal(res.body.global.max_latency_ms, 5000);
    });

    it("does not generate session_results for abandoned sessions", async () => {
      const session = await createSession([
        { section_id: testSectionId1, question_count: 1 },
      ]);
      await startSession(session.id);
      await request(app).post(`/api/sessions/${session.id}/abandon`);

      const results = await db("session_results")
        .where("session_id", session.id)
        .select("*");
      assert.equal(results.length, 0);
    });
  });
});
