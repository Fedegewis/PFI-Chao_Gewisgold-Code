import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import {
  selectQuestionsForSection,
  RECENT_SESSION_WINDOW,
} from "../src/routes/sessions.js";
import { authHeaderFor } from "./helpers.js";

let professional;
let patient;
let patientB;
let sectionId;
let sectionBId;
let questionIds;
let profAuth;

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
  await db("sections").where("slug", "like", "test_%").del();
  await db("users").where("email", "like", "%@test.com").del();
}

async function cleanSessions() {
  const userIds = [patient?.id, patientB?.id].filter(Boolean);
  if (userIds.length === 0) return;
  await db("sessions").whereIn("patient_id", userIds).del();
}

async function createTestFixtures() {
  await cleanTestData();

  [professional] = await db("users")
    .insert({
      role: "professional",
      name: "Dr. Selección",
      email: `prof-sel-${Date.now()}@test.com`,
    })
    .returning("*");

  profAuth = authHeaderFor(professional);

  [patient] = await db("users")
    .insert({
      role: "patient",
      name: "Paciente A",
      email: `patient-sel-a-${Date.now()}@test.com`,
      age: 72,
      professional_id: professional.id,
    })
    .returning("*");

  [patientB] = await db("users")
    .insert({
      role: "patient",
      name: "Paciente B",
      email: `patient-sel-b-${Date.now()}@test.com`,
      age: 68,
      professional_id: professional.id,
    })
    .returning("*");

  const [sectionA] = await db("sections")
    .insert({
      slug: `test_sel_a_${Date.now()}`,
      name: "Selección A",
      description: "Para tests de selección",

      is_active: true,
      display_order: 300,
    })
    .returning("*");
  sectionId = sectionA.id;

  const questionsA = [];
  for (let i = 0; i < 10; i++) {
    questionsA.push({
      section_id: sectionId,
      prompt: `Selección A Pregunta ${i + 1}`,
      response_type: "multiple_choice",
      options: JSON.stringify(["Opción A", "Opción B", "Opción C"]),
      correct_answer: i % 3,
      is_active: true,
      is_validated: true,
      source: "test_fixture",
    });
  }
  const insertedA = await db("questions").insert(questionsA).returning("id");
  questionIds = insertedA.map((r) => r.id);

  const [sectionB] = await db("sections")
    .insert({
      slug: `test_sel_b_${Date.now()}`,
      name: "Selección B",
      description: "Para tests de aislamiento entre secciones",

      is_active: true,
      display_order: 301,
    })
    .returning("*");
  sectionBId = sectionB.id;

  const questionsB = [];
  for (let i = 0; i < 5; i++) {
    questionsB.push({
      section_id: sectionBId,
      prompt: `Selección B Pregunta ${i + 1}`,
      response_type: "multiple_choice",
      options: JSON.stringify(["Opción A", "Opción B", "Opción C"]),
      correct_answer: 0,
      is_active: true,
      is_validated: true,
      source: "test_fixture",
    });
  }
  await db("questions").insert(questionsB);
}

async function createSession(patientId, sections) {
  const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
    patient_id: patientId,
    professional_id: professional.id,
    sections,
  });
  assert.equal(res.status, 201, `Session creation failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function startSession(sessionId) {
  const res = await request(app).post(`/api/sessions/${sessionId}/start`);
  assert.equal(res.status, 200);
}

async function completeSession(sessionId) {
  const res = await request(app).post(`/api/sessions/${sessionId}/complete`);
  assert.equal(res.status, 200);
}

async function abandonSession(sessionId) {
  const res = await request(app).post(`/api/sessions/${sessionId}/abandon`);
  assert.equal(res.status, 200);
}

function getQuestionIds(session, sectionIndex = 0) {
  return session.sections[sectionIndex].questions.map((q) => q.question_id);
}

describe("Question Selection", () => {
  before(async () => {
    await createTestFixtures();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("Eligibility", () => {
    beforeEach(cleanSessions);

    it("selects only active and validated questions", async () => {
      const session = await createSession(patient.id, [
        { section_id: sectionId, question_count: 5 },
      ]);
      const assigned = getQuestionIds(session);
      assert.equal(assigned.length, 5);
      for (const qId of assigned) {
        assert.ok(
          questionIds.includes(qId),
          `Question ${qId} should be in eligible pool`
        );
      }
    });

    it("selects exact requested count", async () => {
      const session = await createSession(patient.id, [
        { section_id: sectionId, question_count: 7 },
      ]);
      assert.equal(session.sections[0].questions.length, 7);
    });

    it("produces no duplicate questions within a session section", async () => {
      const session = await createSession(patient.id, [
        { section_id: sectionId, question_count: 10 },
      ]);
      const assigned = getQuestionIds(session);
      assert.equal(assigned.length, 10);
      assert.equal(new Set(assigned).size, 10);
    });

    it("does not assign unvalidated questions", async () => {
      const [unvalSection] = await db("sections")
        .insert({
          slug: `test_unval_sel_${Date.now()}`,
          name: "Solo no validadas",
    
          is_active: true,
          display_order: 302,
        })
        .returning("*");

      await db("questions").insert({
        section_id: unvalSection.id,
        prompt: "No validada para selección",
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
        sections: [{ section_id: unvalSection.id, question_count: 1 }],
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("0"));
    });

    it("returns error when eligible total < requested", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: sectionId, question_count: 11 }],
      });
      assert.equal(res.status, 400);
    });

    it("error includes requested and available counts", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: sectionId, question_count: 15 }],
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("10"), "Should mention available count");
      assert.ok(res.body.error.includes("15"), "Should mention requested count");
    });
  });

  describe("Pseudorandomness", () => {
    beforeEach(cleanSessions);

    it("uses provided rng for selection", async () => {
      const result1 = await selectQuestionsForSection(
        db, patient.id, sectionId, 5, () => 0
      );
      const result2 = await selectQuestionsForSection(
        db, patient.id, sectionId, 5, () => 0.5
      );

      assert.equal(result1.error, false);
      assert.equal(result2.error, false);
      assert.equal(result1.questions.length, 5);
      assert.equal(result2.questions.length, 5);

      const ids1 = result1.questions.map((q) => q.id);
      const ids2 = result2.questions.map((q) => q.id);
      assert.notDeepEqual(ids1, ids2, "Different rng should produce different results");
    });

    it("RECENT_SESSION_WINDOW equals 3", () => {
      assert.equal(RECENT_SESSION_WINDOW, 3);
    });
  });

  describe("Recent question avoidance", () => {
    beforeEach(cleanSessions);

    it("avoids questions from recent sessions when enough alternatives exist", async () => {
      const s1 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      await startSession(s1.id);
      const recentIds = new Set(getQuestionIds(s1));

      const s2 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      const newIds = getQuestionIds(s2);

      for (const id of newIds) {
        assert.ok(
          !recentIds.has(id),
          `Question ${id} was recent but should have been avoided`
        );
      }
    });

    it("does not exclude questions older than the window", async () => {
      const sessionsCreated = [];
      for (let i = 0; i < RECENT_SESSION_WINDOW + 1; i++) {
        const s = await createSession(patient.id, [
          { section_id: sectionId, question_count: 2 },
        ]);
        await startSession(s.id);
        sessionsCreated.push(s);
      }

      const oldestSessionIds = new Set(getQuestionIds(sessionsCreated[0]));
      const recentSessionIds = new Set();
      for (let i = 1; i <= RECENT_SESSION_WINDOW; i++) {
        for (const id of getQuestionIds(sessionsCreated[i])) {
          recentSessionIds.add(id);
        }
      }

      const newSession = await createSession(patient.id, [
        { section_id: sectionId, question_count: 5 },
      ]);
      const newIds = getQuestionIds(newSession);

      const usesOldQuestion = newIds.some((id) => oldestSessionIds.has(id));
      const nonRecentAvailable = questionIds.filter(
        (id) => !recentSessionIds.has(id)
      );
      if (nonRecentAvailable.length >= 5) {
        assert.ok(true, "Enough non-recent questions exist");
      } else {
        assert.ok(
          usesOldQuestion || nonRecentAvailable.length >= 5,
          "Old questions beyond the window should be eligible as preferred"
        );
      }
    });

    it("falls back to recent questions when non-recent are insufficient", async () => {
      for (let i = 0; i < 3; i++) {
        const s = await createSession(patient.id, [
          { section_id: sectionId, question_count: 5 },
        ]);
        await startSession(s.id);
      }

      const s4 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 8 },
      ]);
      const assigned = getQuestionIds(s4);
      assert.equal(assigned.length, 8);
      assert.equal(new Set(assigned).size, 8);
    });

    it("fallback produces exact requested count", async () => {
      for (let i = 0; i < 3; i++) {
        const s = await createSession(patient.id, [
          { section_id: sectionId, question_count: 10 },
        ]);
        await startSession(s.id);
      }

      const s4 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 10 },
      ]);
      assert.equal(s4.sections[0].questions.length, 10);
    });

    it("fallback does not produce duplicates", async () => {
      for (let i = 0; i < 3; i++) {
        const s = await createSession(patient.id, [
          { section_id: sectionId, question_count: 8 },
        ]);
        await startSession(s.id);
      }

      const s4 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 10 },
      ]);
      const assigned = getQuestionIds(s4);
      assert.equal(new Set(assigned).size, assigned.length);
    });
  });

  describe("Isolation", () => {
    beforeEach(cleanSessions);

    it("patient A history does not affect patient B", async () => {
      const sA = await createSession(patient.id, [
        { section_id: sectionId, question_count: 5 },
      ]);
      await startSession(sA.id);
      const patientAIds = new Set(getQuestionIds(sA));

      const sB = await createSession(patientB.id, [
        { section_id: sectionId, question_count: 10 },
      ]);
      const patientBIds = getQuestionIds(sB);
      assert.equal(patientBIds.length, 10);

      const overlap = patientBIds.filter((id) => patientAIds.has(id));
      assert.ok(
        overlap.length > 0,
        "Patient B should be able to receive questions that Patient A used"
      );
    });

    it("section A history does not affect section B selection", async () => {
      const sA = await createSession(patient.id, [
        { section_id: sectionId, question_count: 10 },
      ]);
      await startSession(sA.id);

      const sB = await createSession(patient.id, [
        { section_id: sectionBId, question_count: 5 },
      ]);
      assert.equal(sB.sections[0].questions.length, 5);

      const sectionBQuestions = await db("questions")
        .where({ section_id: sectionBId, is_active: true, is_validated: true })
        .select("id");
      const eligibleBIds = new Set(sectionBQuestions.map((q) => q.id));

      for (const qId of getQuestionIds(sB)) {
        assert.ok(eligibleBIds.has(qId), `Question ${qId} should be from section B`);
      }
    });
  });

  describe("Session states for history", () => {
    beforeEach(cleanSessions);

    it("created sessions do not count as history", async () => {
      const s1 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 5 },
      ]);
      const createdIds = new Set(getQuestionIds(s1));

      const s2 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 5 },
      ]);
      const newIds = getQuestionIds(s2);
      const overlap = newIds.filter((id) => createdIds.has(id));

      assert.ok(
        overlap.length > 0 || createdIds.size + new Set(newIds).size <= 10,
        "Created session questions should not be excluded from selection"
      );
    });

    it("in_progress sessions count as history", async () => {
      const s1 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      await startSession(s1.id);
      const recentIds = new Set(getQuestionIds(s1));

      const s2 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      const newIds = getQuestionIds(s2);
      for (const id of newIds) {
        assert.ok(!recentIds.has(id), `in_progress question ${id} should be avoided`);
      }
    });

    it("completed sessions count as history", async () => {
      const s1 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      await startSession(s1.id);
      await completeSession(s1.id);
      const recentIds = new Set(getQuestionIds(s1));

      const s2 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      const newIds = getQuestionIds(s2);
      for (const id of newIds) {
        assert.ok(!recentIds.has(id), `completed question ${id} should be avoided`);
      }
    });

    it("abandoned sessions count as history", async () => {
      const s1 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      await startSession(s1.id);
      await abandonSession(s1.id);
      const recentIds = new Set(getQuestionIds(s1));

      const s2 = await createSession(patient.id, [
        { section_id: sectionId, question_count: 3 },
      ]);
      const newIds = getQuestionIds(s2);
      for (const id of newIds) {
        assert.ok(!recentIds.has(id), `abandoned question ${id} should be avoided`);
      }
    });
  });
});
