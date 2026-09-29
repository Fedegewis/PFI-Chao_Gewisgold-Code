// 7G: tests end-to-end del endpoint /sessions/:id/analysis.
// - Mockean el cliente Ollama vía analysisRouteDeps.generate.
// - Usan base de datos real; fixtures propias con cleanup por CASCADE.
// - AI_ENABLED se setea en 'true' para el arranque del cliente; con generate
//   mockeado, el default de OLLAMA_DISABLED se prueba explícitamente en un
//   caso puntual desactivando el mock y removiendo AI_ENABLED.

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.AI_ENABLED = process.env.AI_ENABLED || "true";
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import { analysisRouteDeps } from "../src/routes/analysis.js";
import { OllamaClientError, OllamaErrorCodes } from "../src/services/ai/errors.js";

// -----------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------

let profA, profB, patientA, sectionRow;
let cleanupUserIds = [];
let cleanupSessionIds = [];

async function makeCompletedSession(patient, professional, sectionId) {
  const [session] = await db("sessions")
    .insert({ patient_id: patient.id, professional_id: professional.id, status: "completed", started_at: new Date(Date.now() - 60000), completed_at: new Date() })
    .returning("*");
  cleanupSessionIds.push(session.id);
  const [ss] = await db("session_sections")
    .insert({ session_id: session.id, section_id: sectionId, requested_count: 1, display_order: 1 })
    .returning("*");
  const [q] = await db("questions")
    .where({ section_id: sectionId, is_active: true })
    .orderBy("id").limit(1).select("*");
  await db("session_questions")
    .insert({
      session_section_id: ss.id, question_id: q.id, display_order: 1,
      prompt_snapshot: q.prompt, options_snapshot: JSON.stringify(q.options),
      correct_answer_snapshot: q.correct_answer ?? 0, response_type: q.response_type,
    });
  await db("session_results").insert({
    session_id: session.id, section_id: sectionId,
    total_questions: 1, answered_questions: 1, correct_count: 1,
    incorrect_count: 0, unanswered_count: 0, accuracy: 1,
    completion_rate: 1, mean_latency_ms: 4200,
    min_latency_ms: 4200, max_latency_ms: 4200, latency_std_ms: 0,
  });
  await db("session_results").insert({
    session_id: session.id, section_id: null,
    total_questions: 1, answered_questions: 1, correct_count: 1,
    incorrect_count: 0, unanswered_count: 0, accuracy: 1,
    completion_rate: 1, mean_latency_ms: 4200,
    min_latency_ms: 4200, max_latency_ms: 4200, latency_std_ms: 0,
  });
  return session;
}

async function makeSessionWithStatus(patient, professional, sectionId, status) {
  const [session] = await db("sessions")
    .insert({ patient_id: patient.id, professional_id: professional.id, status })
    .returning("*");
  cleanupSessionIds.push(session.id);
  const [ss] = await db("session_sections")
    .insert({ session_id: session.id, section_id: sectionId, requested_count: 1, display_order: 1 })
    .returning("*");
  const [q] = await db("questions")
    .where({ section_id: sectionId, is_active: true })
    .orderBy("id").limit(1).select("*");
  await db("session_questions")
    .insert({
      session_section_id: ss.id, question_id: q.id, display_order: 1,
      prompt_snapshot: q.prompt, options_snapshot: JSON.stringify(q.options),
      correct_answer_snapshot: q.correct_answer ?? 0, response_type: q.response_type,
    });
  return session;
}

// Respuesta válida del modelo (schema v1) para el fixture creado.
function fakeValidResponseText() {
  return JSON.stringify({
    schema_version: "1",
    summary: "Sesión completa. Se respondió la pregunta.",
    observations_by_section: [
      { section_slug: sectionRow.slug, observation: "1/1 respondida sin dejar preguntas en blanco." },
    ],
    aspects_to_review: [],
    evidence: [
      { scope: "global", metric: "accuracy", value: 1 },
      { scope: "section", metric: "mean_latency_ms", value: 4200, section_slug: sectionRow.slug },
    ],
  });
}

// -----------------------------------------------------------------
// Suite
// -----------------------------------------------------------------

describe("POST/GET /api/sessions/:id/analysis (7G)", () => {
  before(async () => {
    const stamp = Date.now();
    [profA] = await db("users")
      .insert({ role: "professional", name: "Dr A", email: `analysis-a-${stamp}@test.com` })
      .returning("*");
    [profB] = await db("users")
      .insert({ role: "professional", name: "Dr B", email: `analysis-b-${stamp}@test.com` })
      .returning("*");
    [patientA] = await db("users")
      .insert({ role: "patient", name: "Pac A", email: `analysis-pat-${stamp}@test.com`, professional_id: profA.id, age: 70 })
      .returning("*");
    cleanupUserIds = [patientA.id, profB.id, profA.id];
    sectionRow = await db("sections").where({ slug: "atencion_visual" }).first();
  });

  after(async () => {
    if (cleanupSessionIds.length > 0) {
      await db("sessions").whereIn("id", cleanupSessionIds).del();
    }
    if (cleanupUserIds.length > 0) {
      await db("users").whereIn("id", cleanupUserIds).del();
    }
    await db.destroy();
  });

  afterEach(() => {
    analysisRouteDeps.generate = null;
  });

  // ---- POST ----

  describe("POST auth y ownership", () => {
    it("401 sin token", async () => {
      const res = await request(app).post("/api/sessions/1/analysis");
      assert.equal(res.status, 401);
    });

    it("403 con token de paciente", async () => {
      const res = await request(app)
        .post("/api/sessions/1/analysis")
        .set("Authorization", authHeaderFor(patientA));
      assert.equal(res.status, 403);
    });

    it("404 para sesión inexistente", async () => {
      const res = await request(app)
        .post("/api/sessions/999999999/analysis")
        .set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 404);
    });

    it("404 (uniforme) para sesión de otro profesional", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      const res = await request(app)
        .post(`/api/sessions/${ses.id}/analysis`)
        .set("Authorization", authHeaderFor(profB));
      assert.equal(res.status, 404);
    });

    it("400 para sesión in_progress/created/abandoned", async () => {
      for (const st of ["created", "in_progress", "abandoned"]) {
        const ses = await makeSessionWithStatus(patientA, profA, sectionRow.id, st);
        const res = await request(app)
          .post(`/api/sessions/${ses.id}/analysis`)
          .set("Authorization", authHeaderFor(profA));
        assert.equal(res.status, 400, `estado ${st} debe 400`);
      }
    });
  });

  describe("POST force param", () => {
    it("400 si force !== 'true' | 'false'", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      const res = await request(app)
        .post(`/api/sessions/${ses.id}/analysis?force=YES`)
        .set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 400);
    });
    it("acepta force=false explícito", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => ({
        text: fakeValidResponseText(), raw: {}, latencyMs: 7000, model: "llama3.2:3b",
      });
      const res = await request(app)
        .post(`/api/sessions/${ses.id}/analysis?force=false`)
        .set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 201);
    });
  });

  describe("POST pipeline exitoso", () => {
    it("201 generated persiste con model+latency y devuelve content validado; sin PII/raw/prompt", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      let calls = 0;
      analysisRouteDeps.generate = async (args) => {
        calls++;
        assert.equal(args.format, "json");
        assert.ok(!args.prompt.includes("Pac A")); // no PII
        assert.ok(!args.prompt.includes("patient_age")); // no age
        assert.ok(!args.prompt.includes("correct_answer"));
        assert.ok(!args.prompt.includes("stimulus_snapshot"));
        return { text: fakeValidResponseText(), raw: {}, latencyMs: 6500, model: args.model };
      };
      const res = await request(app)
        .post(`/api/sessions/${ses.id}/analysis`)
        .set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 201);
      assert.equal(res.body.source, "generated");
      assert.equal(res.body.analysis.session_id, ses.id);
      assert.equal(res.body.analysis.model, "llama3.2:3b");
      assert.equal(res.body.analysis.latency_ms, 6500);
      assert.equal(res.body.analysis.schema_version, "1");
      assert.equal(res.body.analysis.prompt_version, "1.2");
      assert.equal(res.body.analysis.content.schema_version, "1");
      assert.equal(res.body.analysis.content.summary.length > 0, true);
      // no raw/prompt/context/error_message expuestos:
      assert.equal(res.body.analysis.error_code, undefined);
      assert.equal(res.body.analysis.error_message, undefined);
      assert.equal(res.body.analysis.prompt, undefined);
      assert.equal(res.body.analysis.context, undefined);
      assert.equal(res.body.analysis.raw, undefined);
      assert.equal(calls, 1);

      // Verificación en DB.
      const row = await db("session_analyses").where({ id: res.body.analysis.id }).first();
      assert.equal(row.status, "ok");
      assert.equal(row.error_code, null);
      const rowJson = JSON.stringify(row);
      assert.ok(!rowJson.includes("Pac A"));
      assert.ok(!rowJson.includes("SYSTEM:"));
      assert.ok(!rowJson.includes("CONTEXT "));
    });
  });

  describe("POST cache", () => {
    it("segundo POST devuelve 200 source=cache y no re-llama Ollama", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      let calls = 0;
      analysisRouteDeps.generate = async () => {
        calls++;
        return { text: fakeValidResponseText(), raw: {}, latencyMs: 6000, model: "llama3.2:3b" };
      };
      const r1 = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r1.status, 201);
      const r2 = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r2.status, 200);
      assert.equal(r2.body.source, "cache");
      assert.equal(r2.body.analysis.id, r1.body.analysis.id);
      assert.equal(calls, 1, "Ollama debe llamarse una sola vez");
      const rows = await db("session_analyses").where({ session_id: ses.id });
      assert.equal(rows.length, 1, "cache hit no inserta fila");
    });

    it("force=true genera un nuevo intento aunque haya caché", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => ({ text: fakeValidResponseText(), raw: {}, latencyMs: 6000, model: "llama3.2:3b" });
      await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis?force=true`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 201);
      assert.equal(res.body.source, "generated");
      const rows = await db("session_analyses").where({ session_id: ses.id }).select("*");
      assert.equal(rows.length, 2);
    });
  });

  describe("POST errores IA", () => {
    it("AI_ENABLED=false → 503 y persiste failed OLLAMA_DISABLED", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      const prev = process.env.AI_ENABLED;
      process.env.AI_ENABLED = "false";
      try {
        analysisRouteDeps.generate = null; // usa cliente real
        const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
        assert.equal(res.status, 503);
        assert.equal(res.body.status, "ai_unavailable");
        const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
        assert.equal(row.error_code, "OLLAMA_DISABLED");
      } finally {
        process.env.AI_ENABLED = prev;
      }
    });

    it("Ollama offline → 502 y persiste failed OLLAMA_OFFLINE", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => {
        throw new OllamaClientError(OllamaErrorCodes.OLLAMA_OFFLINE, "boom");
      };
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 502);
      const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
      assert.equal(row.error_code, "OLLAMA_OFFLINE");
      assert.equal(row.latency_ms, null);
    });

    it("timeout → 502 y persiste failed OLLAMA_TIMEOUT", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => {
        throw new OllamaClientError(OllamaErrorCodes.OLLAMA_TIMEOUT, "timeout");
      };
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 502);
      const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
      assert.equal(row.error_code, "OLLAMA_TIMEOUT");
    });

    it("model not found → 502 y persiste failed OLLAMA_MODEL_NOT_FOUND", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => {
        throw new OllamaClientError(OllamaErrorCodes.MODEL_NOT_FOUND, "no such model");
      };
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 502);
      const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
      assert.equal(row.error_code, "OLLAMA_MODEL_NOT_FOUND");
    });

    it("JSON inválido del modelo → 502 y persiste ANALYSIS_INVALID_JSON conservando latency", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => ({ text: "{oops", raw: {}, latencyMs: 8300, model: "llama3.2:3b" });
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 502);
      assert.equal(res.body.status, "ai_invalid_output");
      const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
      assert.equal(row.error_code, "ANALYSIS_INVALID_JSON");
      assert.equal(row.latency_ms, 8300);
      assert.equal(row.model, "llama3.2:3b");
    });

    it("schema inválido → ANALYSIS_SCHEMA_INVALID conservando latency", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => ({
        text: JSON.stringify({ schema_version: "2", summary: "x", observations_by_section: [], aspects_to_review: [], evidence: [] }),
        raw: {}, latencyMs: 9100, model: "llama3.2:3b",
      });
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 502);
      const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
      assert.equal(row.error_code, "ANALYSIS_SCHEMA_INVALID");
      assert.equal(row.latency_ms, 9100);
    });

    it("evidence inválida → ANALYSIS_EVIDENCE_INVALID conservando latency; NO persiste raw", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      const badText = JSON.stringify({
        schema_version: "1",
        summary: "s",
        observations_by_section: [{ section_slug: sectionRow.slug, observation: "x" }],
        aspects_to_review: [],
        evidence: [{ scope: "global", metric: "accuracy", value: 0.42 }], // real: 1
      });
      analysisRouteDeps.generate = async () => ({ text: badText, raw: {}, latencyMs: 7700, model: "llama3.2:3b" });
      const res = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(res.status, 502);
      const row = await db("session_analyses").where({ session_id: ses.id, status: "failed" }).first();
      assert.equal(row.error_code, "ANALYSIS_EVIDENCE_INVALID");
      assert.equal(row.latency_ms, 7700);
      // Nunca persistimos el raw output del modelo:
      assert.ok(!(row.error_message || "").includes("badText"));
      const rowJson = JSON.stringify(row);
      assert.ok(!rowJson.includes("\"summary\":\"s\""));
    });
  });

  // ---- GET ----

  describe("GET", () => {
    it("401 sin token, 403 con paciente, 404 ownership uniforme", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      let r = await request(app).get(`/api/sessions/${ses.id}/analysis`);
      assert.equal(r.status, 401);
      r = await request(app).get(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(patientA));
      assert.equal(r.status, 403);
      r = await request(app).get(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profB));
      assert.equal(r.status, 404);
    });

    it("400 si sesión no está completada", async () => {
      const ses = await makeSessionWithStatus(patientA, profA, sectionRow.id, "in_progress");
      const r = await request(app).get(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r.status, 400);
    });

    it("404 status=no_analysis si nunca hubo ok", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      const r = await request(app).get(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r.status, 404);
      assert.equal(r.body.status, "no_analysis");
    });

    it("devuelve el último ok y NO devuelve el failed más reciente", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      analysisRouteDeps.generate = async () => ({ text: fakeValidResponseText(), raw: {}, latencyMs: 6000, model: "llama3.2:3b" });
      const gen = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      const okId = gen.body.analysis.id;
      // Después insertamos un failed manualmente para simular un intento posterior fallido.
      await db("session_analyses").insert({
        session_id: ses.id, status: "failed", error_code: "OLLAMA_TIMEOUT",
      });
      const r = await request(app).get(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r.status, 200);
      assert.equal(r.body.source, "stored");
      assert.equal(r.body.analysis.id, okId);
      assert.equal(r.body.analysis.error_message, undefined);
    });
  });

  describe("Cache — model/prompt/schema variation", () => {
    it("modelo distinto NO es cache hit", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      // Insertar un ok directo con otro modelo:
      await db("session_analyses").insert({
        session_id: ses.id, status: "ok",
        model: "otro-modelo", schema_version: "1", prompt_version: "1.0",
        analysis: JSON.parse(fakeValidResponseText()),
        latency_ms: 100,
      });
      let calls = 0;
      analysisRouteDeps.generate = async () => { calls++; return { text: fakeValidResponseText(), raw: {}, latencyMs: 6000, model: "llama3.2:3b" }; };
      const r = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r.status, 201);
      assert.equal(r.body.source, "generated");
      assert.equal(calls, 1);
    });

    it("prompt_version distinta NO es cache hit", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      await db("session_analyses").insert({
        session_id: ses.id, status: "ok",
        model: "llama3.2:3b", schema_version: "1", prompt_version: "0.9",
        analysis: JSON.parse(fakeValidResponseText()), latency_ms: 100,
      });
      analysisRouteDeps.generate = async () => ({ text: fakeValidResponseText(), raw: {}, latencyMs: 6000, model: "llama3.2:3b" });
      const r = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r.body.source, "generated");
    });

    it("schema_version distinta NO es cache hit", async () => {
      const ses = await makeCompletedSession(patientA, profA, sectionRow.id);
      await db("session_analyses").insert({
        session_id: ses.id, status: "ok",
        model: "llama3.2:3b", schema_version: "old", prompt_version: "1.0",
        analysis: JSON.parse(fakeValidResponseText()), latency_ms: 100,
      });
      analysisRouteDeps.generate = async () => ({ text: fakeValidResponseText(), raw: {}, latencyMs: 6000, model: "llama3.2:3b" });
      const r = await request(app).post(`/api/sessions/${ses.id}/analysis`).set("Authorization", authHeaderFor(profA));
      assert.equal(r.body.source, "generated");
    });
  });
});
