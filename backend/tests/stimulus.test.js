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
  await db("session_questions").whereIn(
    "session_section_id",
    db("session_sections").select("id").whereIn(
      "session_id",
      db("sessions").select("id")
    )
  ).del();
  await db("session_sections").whereIn(
    "session_id",
    db("sessions").select("id")
  ).del();
  await db("answers").whereIn(
    "session_question_id",
    db("session_questions").select("id")
  ).del();
  await db("sessions").del();
  await db("questions").where("source", "test_stimulus_fixture").del();
  await db("sections").where("slug", "like", "test_stimulus_%").del();
  await db("users").where("email", "like", "%@test-stimulus.com").del();
}

async function createTestFixtures() {
  await cleanTestData();

  [professional] = await db("users")
    .insert({ role: "professional", name: "Dr. Stimulus", email: `prof-${Date.now()}@test-stimulus.com` })
    .returning("*");

  profAuth = authHeaderFor(professional);

  [patient] = await db("users")
    .insert({
      role: "patient",
      name: "Paciente Stimulus",
      email: `patient-${Date.now()}@test-stimulus.com`,
      age: 70,
      professional_id: professional.id,
    })
    .returning("*");

  const [section] = await db("sections")
    .insert({
      slug: `test_stimulus_section_${Date.now()}`,
      name: "Sección stimulus test",
      description: "Sección para tests de stimulus",
      is_active: true,
      display_order: 200,
    })
    .returning("*");

  testSectionId = section.id;

  await db("questions").insert([
    {
      section_id: testSectionId,
      prompt: "¿Dónde dejó los anteojos?",
      stimulus: "Patricia dejó la cartera en la silla, los anteojos en la mesita y el teléfono en el sillón.",
      response_type: "multiple_choice",
      options: JSON.stringify(["En la silla", "En la mesita", "En el sillón", "En la mesa"]),
      correct_answer: 1,
      is_active: true,
      is_validated: true,
      source: "test_stimulus_fixture",
    },
    {
      section_id: testSectionId,
      prompt: "¿Cuál de estos objetos NO es un electrodoméstico?",
      stimulus: null,
      response_type: "multiple_choice",
      options: JSON.stringify(["Heladera", "Microondas", "Silla", "Lavarropas"]),
      correct_answer: 2,
      is_active: true,
      is_validated: true,
      source: "test_stimulus_fixture",
    },
    {
      section_id: testSectionId,
      prompt: "¿Qué objeto cambió de lugar?",
      stimulus: "En el living había un florero, un reloj y una lámpara. Ahora hay un florero, un cuadro y una lámpara.",
      response_type: "multiple_choice",
      options: JSON.stringify(["El florero", "El reloj", "La lámpara", "El cuadro"]),
      correct_answer: 1,
      is_active: true,
      is_validated: true,
      source: "test_stimulus_fixture",
    },
  ]);
}

describe("Stimulus support", () => {
  before(async () => {
    await createTestFixtures();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("Schema", () => {
    it("questions table has stimulus column", async () => {
      const columns = await db("questions").columnInfo();
      assert.ok(columns.stimulus, "questions.stimulus column should exist");
      assert.equal(columns.stimulus.nullable, true);
    });

    it("session_questions table has stimulus_snapshot column", async () => {
      const columns = await db("session_questions").columnInfo();
      assert.ok(columns.stimulus_snapshot, "session_questions.stimulus_snapshot column should exist");
      assert.equal(columns.stimulus_snapshot.nullable, true);
    });
  });

  describe("Session creation snapshots stimulus", () => {
    it("copies stimulus to stimulus_snapshot when present", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 3 }],
      });
      assert.equal(res.status, 201);

      const questions = res.body.sections[0].questions;
      assert.equal(questions.length, 3);

      const withStimulus = questions.filter((q) => q.stimulus_snapshot !== null);
      const withoutStimulus = questions.filter((q) => q.stimulus_snapshot === null);

      assert.equal(withStimulus.length, 2, "2 questions should have stimulus_snapshot");
      assert.equal(withoutStimulus.length, 1, "1 question should have null stimulus_snapshot");

      const stimulusQ = withStimulus.find((q) => q.prompt_snapshot === "¿Dónde dejó los anteojos?");
      assert.ok(stimulusQ, "should find the stimulus question by prompt");
      assert.equal(
        stimulusQ.stimulus_snapshot,
        "Patricia dejó la cartera en la silla, los anteojos en la mesita y el teléfono en el sillón."
      );
    });

    it("sets stimulus_snapshot to null when question has no stimulus", async () => {
      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 3 }],
      });
      assert.equal(res.status, 201);

      const questions = res.body.sections[0].questions;
      const noStimulusQ = questions.find((q) => q.prompt_snapshot.includes("electrodoméstico"));
      assert.ok(noStimulusQ, "should find the no-stimulus question");
      assert.equal(noStimulusQ.stimulus_snapshot, null);
    });
  });

  describe("GET /api/sessions/:id exposes stimulus_snapshot", () => {
    it("returns stimulus_snapshot in session questions", async () => {
      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 3 }],
      });
      assert.equal(createRes.status, 201);

      const getRes = await request(app).get(`/api/sessions/${createRes.body.id}`).set("Authorization", profAuth);
      assert.equal(getRes.status, 200);

      const questions = getRes.body.sections[0].questions;
      assert.equal(questions.length, 3);

      const hasStimulus = questions.some((q) => q.stimulus_snapshot !== null);
      const hasNull = questions.some((q) => q.stimulus_snapshot === null);
      assert.ok(hasStimulus, "at least one question should have stimulus_snapshot");
      assert.ok(hasNull, "at least one question should have null stimulus_snapshot");
    });
  });

  describe("Snapshot immutability", () => {
    it("modifying question stimulus does not affect existing session snapshot", async () => {
      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 3 }],
      });
      assert.equal(createRes.status, 201);
      const sessionId = createRes.body.id;

      const originalQuestions = createRes.body.sections[0].questions;
      const stimulusQ = originalQuestions.find((q) => q.prompt_snapshot === "¿Dónde dejó los anteojos?");
      const originalStimulus = stimulusQ.stimulus_snapshot;

      await db("questions")
        .where("id", stimulusQ.question_id)
        .update({ stimulus: "CHANGED STIMULUS" });

      const getRes = await request(app).get(`/api/sessions/${sessionId}`).set("Authorization", profAuth);
      const snapshotQ = getRes.body.sections[0].questions.find((q) => q.prompt_snapshot === "¿Dónde dejó los anteojos?");
      assert.equal(snapshotQ.stimulus_snapshot, originalStimulus, "snapshot should not change when source question is modified");

      await db("questions")
        .where("id", stimulusQ.question_id)
        .update({ stimulus: "Patricia dejó la cartera en la silla, los anteojos en la mesita y el teléfono en el sillón." });
    });
  });

  describe("Scoring unaffected by stimulus", () => {
    it("answering a question with stimulus works normally", async () => {
      const createRes = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: testSectionId, question_count: 3 }],
      });
      const sessionId = createRes.body.id;

      await request(app).post(`/api/sessions/${sessionId}/start`);

      const questions = createRes.body.sections[0].questions;
      for (const q of questions) {
        const answerRes = await request(app).post(`/api/sessions/${sessionId}/answers`).send({
          session_question_id: q.id,
          selected_answer: q.correct_answer_snapshot,
          response_time_ms: 3000,
        });
        assert.equal(answerRes.status, 201);
        assert.equal(answerRes.body.is_correct, true);
      }

      const completeRes = await request(app).post(`/api/sessions/${sessionId}/complete`);
      assert.equal(completeRes.status, 200);
      assert.equal(completeRes.body.status, "completed");

      const resultsRes = await request(app).get(`/api/sessions/${sessionId}/results`).set("Authorization", profAuth);
      assert.equal(resultsRes.status, 200);
      assert.equal(resultsRes.body.global.accuracy, 1);
    });
  });

  describe("Existing questions without stimulus", () => {
    it("legacy questions work without stimulus field", async () => {
      const [legacySection] = await db("sections")
        .insert({
          slug: `test_stimulus_legacy_${Date.now()}`,
          name: "Legacy section",
          is_active: true,
          display_order: 201,
        })
        .returning("*");

      await db("questions").insert({
        section_id: legacySection.id,
        prompt: "Pregunta legacy sin stimulus",
        response_type: "multiple_choice",
        options: JSON.stringify(["A", "B", "C"]),
        correct_answer: 0,
        is_active: true,
        is_validated: true,
        source: "test_stimulus_fixture",
      });

      const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
        patient_id: patient.id,
        professional_id: professional.id,
        sections: [{ section_id: legacySection.id, question_count: 1 }],
      });
      assert.equal(res.status, 201);

      const q = res.body.sections[0].questions[0];
      assert.equal(q.stimulus_snapshot, null, "legacy question should have null stimulus_snapshot");
      assert.ok(q.prompt_snapshot, "prompt_snapshot should still be present");
    });
  });
});
