// Contrato v3 — reintento controlado.
//
// Reasons reintenciables en v3:
//   - SCHEMA_INVALID path=summary + info.reason=max_length_exceeded
//   - SCHEMA_INVALID + info.reason=forbidden_clinical_term
//   - SCHEMA_INVALID + info.reason=numeric_metric_in_text
// NO reintenciables: INVALID_JSON, UNEXPECTED_FIELD, errores de Ollama,
//   SCHEMA_INVALID por campo obligatorio ausente.
// MÁXIMO 2 llamadas a Ollama en total.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db/connection.js";
import { generateSessionAnalysis } from "../src/services/ai/analysisService.js";
import { OllamaClientError, OllamaErrorCodes } from "../src/services/ai/errors.js";

const EMAIL_SUFFIX = "@analysis-retry.test.com";
const MODEL = "test-model-retry";

let profA, patientA, sectionRow, sessionRow;

async function cleanTestData() {
  const pids = () => db("users").select("id").where("email", "like", `%${EMAIL_SUFFIX}`);
  const sids = () => db("sessions").select("id").whereIn("patient_id", pids());
  await db("session_analyses").whereIn("session_id", sids()).del();
  const ssids = () => db("session_sections").select("id").whereIn("session_id", sids());
  const sqids = () => db("session_questions").select("id").whereIn("session_section_id", ssids());
  await db("answers").whereIn("session_question_id", sqids()).del();
  await db("session_results").whereIn("session_id", sids()).del();
  await db("session_questions").whereIn("session_section_id", ssids()).del();
  await db("session_sections").whereIn("session_id", sids()).del();
  await db("sessions").whereIn("patient_id", pids()).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function insertCompletedSession() {
  const [s] = await db("sessions").insert({
    patient_id: patientA.id, professional_id: profA.id,
    status: "completed", started_at: new Date(), completed_at: new Date(),
  }).returning("*");
  await db("session_sections").insert({
    session_id: s.id, section_id: sectionRow.id, requested_count: 4, display_order: 1,
  });
  const metrics = {
    total_questions: 4, answered_questions: 4,
    correct_count: 2, incorrect_count: 2, unanswered_count: 0,
    accuracy: 0.5, completion_rate: 1,
    mean_latency_ms: 1500, min_latency_ms: 900, max_latency_ms: 2100, latency_std_ms: 400,
  };
  await db("session_results").insert([
    { session_id: s.id, section_id: sectionRow.id, ...metrics },
    { session_id: s.id, section_id: null, ...metrics },
  ]);
  return s;
}

function validV3() {
  return JSON.stringify({
    schema_version: "3",
    summary: "Síntesis descriptiva de la sesión trabajada por el paciente.",
    aspects_to_review: ["Observar continuidad de la actividad."],
  });
}

function invalidSummaryTooLong() {
  // Techo v3.6 (GENERATION_VALIDATION_OPTIONS.summaryMax): 2400. 2500 chars dispara max_length_exceeded.
  return JSON.stringify({
    schema_version: "3",
    summary: "x".repeat(2500),
  });
}

function invalidClinicalTerm() {
  return JSON.stringify({
    schema_version: "3",
    summary: "Se observa déficit de atención durante la sesión.",
  });
}

function invalidNumericMetric() {
  return JSON.stringify({
    schema_version: "3",
    summary: "La paciente logró 50% de precisión durante la actividad.",
  });
}

function invalidUnexpectedField() {
  return JSON.stringify({
    schema_version: "3",
    summary: "Síntesis.",
    comparison: "no corresponde",
  });
}

function invalidMissingSummary() {
  return JSON.stringify({ schema_version: "3" });
}

function deps(generateFn) {
  return {
    generate: generateFn,
    config: { model: MODEL, url: "http://x", timeoutMs: 5000, enabled: true },
  };
}

describe("Contrato v3 — reintento controlado", () => {
  before(async () => {
    await cleanTestData();
    const stamp = Date.now();
    [profA] = await db("users").insert({
      role: "professional", name: "Prof R", email: `prof-${stamp}${EMAIL_SUFFIX}`,
    }).returning("*");
    [patientA] = await db("users").insert({
      role: "patient", name: "Pat R", email: `pat-${stamp}${EMAIL_SUFFIX}`,
      professional_id: profA.id, age: 70,
    }).returning("*");
    sectionRow = await db("sections").where({ slug: "orientacion_temporal" }).first();
  });

  beforeEach(async () => {
    const sids = await db("sessions").where("patient_id", patientA.id).pluck("id");
    if (sids.length > 0) {
      await db("session_analyses").whereIn("session_id", sids).del();
      const ssids = await db("session_sections").whereIn("session_id", sids).pluck("id");
      if (ssids.length > 0) await db("session_questions").whereIn("session_section_id", ssids).del();
      await db("session_results").whereIn("session_id", sids).del();
      await db("session_sections").whereIn("session_id", sids).del();
      await db("sessions").whereIn("id", sids).del();
    }
    sessionRow = await insertCompletedSession();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  it("1er intento válido → NO reintenta (1 llamada)", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: validV3(), raw: {}, latencyMs: 10, model: MODEL };
    };
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(calls, 1);
    assert.equal(r.source, "generated");
  });

  it("summary > 500 chars 1er intento + 2do válido → OK con 2 llamadas", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: calls === 1 ? invalidSummaryTooLong() : validV3(), raw: {}, latencyMs: 10, model: MODEL };
    };
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(calls, 2);
    assert.equal(r.source, "generated");
    const rows = await db("session_analyses").where("session_id", sessionRow.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "ok");
  });

  it("summary > 500 chars 2 veces → failed con reason max_length_exceeded", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: invalidSummaryTooLong(), raw: {}, latencyMs: 10, model: MODEL };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID" && err.path === "summary" && err.info?.reason === "max_length_exceeded"
    );
    assert.equal(calls, 2);
    const rows = await db("session_analyses").where("session_id", sessionRow.id);
    assert.equal(rows[0].status, "failed");
  });

  it("término clínico 1er intento + 2do válido → OK con 2 llamadas", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: calls === 1 ? invalidClinicalTerm() : validV3(), raw: {}, latencyMs: 10, model: MODEL };
    };
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(calls, 2);
    assert.equal(r.source, "generated");
  });

  it("término clínico 2 veces → failed con reason forbidden_clinical_term", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: invalidClinicalTerm(), raw: {}, latencyMs: 10, model: MODEL };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID" && err.info?.reason === "forbidden_clinical_term"
    );
    assert.equal(calls, 2);
  });

  it("métrica numérica 1er intento + 2do válido → OK con 2 llamadas", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: calls === 1 ? invalidNumericMetric() : validV3(), raw: {}, latencyMs: 10, model: MODEL };
    };
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(calls, 2);
    assert.equal(r.source, "generated");
  });

  it("métrica numérica 2 veces → failed con reason numeric_metric_in_text", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: invalidNumericMetric(), raw: {}, latencyMs: 10, model: MODEL };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID" && err.info?.reason === "numeric_metric_in_text"
    );
    assert.equal(calls, 2);
  });

  it("Ollama offline → NO reintenta (1 llamada)", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      throw new OllamaClientError(OllamaErrorCodes.OLLAMA_OFFLINE, "sin conexión");
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === OllamaErrorCodes.OLLAMA_OFFLINE
    );
    assert.equal(calls, 1);
  });

  it("INVALID_JSON → NO reintenta", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: "esto no es json", raw: {}, latencyMs: 10, model: MODEL };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "INVALID_JSON"
    );
    assert.equal(calls, 1);
  });

  it("UNEXPECTED_FIELD → NO reintenta", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: invalidUnexpectedField(), raw: {}, latencyMs: 10, model: MODEL };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "UNEXPECTED_FIELD"
    );
    assert.equal(calls, 1);
  });

  it("Campo obligatorio ausente → NO reintenta", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return { text: invalidMissingSummary(), raw: {}, latencyMs: 10, model: MODEL };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID"
    );
    assert.equal(calls, 1);
  });

  it("Al generar OK se persisten activities + evidence del backend", async () => {
    const stub = async () => ({ text: validV3(), raw: {}, latencyMs: 10, model: MODEL });
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    const persisted = r.analysis.analysis;
    assert.equal(persisted.schema_version, "3");
    assert.ok(Array.isArray(persisted.activities));
    assert.equal(persisted.activities[0].slug, sectionRow.slug);
    assert.equal(persisted.activities[0].name, sectionRow.name);
    assert.ok(Array.isArray(persisted.evidence));
    assert.ok(persisted.evidence.length > 0);
  });

  it("v3.4: Al generar OK se persisten observations + follow_up determinísticos", async () => {
    const stub = async () => ({ text: validV3(), raw: {}, latencyMs: 10, model: MODEL });
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    const persisted = r.analysis.analysis;
    assert.ok(Array.isArray(persisted.observations));
    assert.ok(persisted.observations.length >= 2);
    assert.ok(Array.isArray(persisted.follow_up));
  });

  it("v3.4: unauthorized_observation_about_actor en 1er intento + 2do válido → OK", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      const text = calls === 1
        ? JSON.stringify({
            schema_version: "3",
            summary: "El profesional observó que el paciente retuvo la lista durante la actividad.",
          })
        : validV3();
      return { text, raw: {}, latencyMs: 10, model: MODEL };
    };
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(calls, 2);
    assert.equal(r.source, "generated");
  });

  it("v3.4: unauthorized_observation_about_actor 2 veces → failed", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return {
        text: JSON.stringify({
          schema_version: "3",
          summary: "El profesional afirmó que la actividad fue completada.",
        }),
        raw: {}, latencyMs: 10, model: MODEL,
      };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID" && err.info?.reason === "unauthorized_observation_about_actor"
    );
    assert.equal(calls, 2);
  });
  // ---- Fase 2 (prompt 3.5) -------------------------------------------------

  it("3.5: aspects_to_review del modelo se descarta (no se persiste ni se valida)", async () => {
    const stub = async () => ({
      text: JSON.stringify({
        schema_version: "3",
        summary: "La sesión de Agenda de turnos fue completada en su totalidad.",
        // Aunque contenga una afirmación no permitida, el campo no se usa.
        aspects_to_review: ["Se recomienda derivar a un especialista."],
      }),
      raw: {}, latencyMs: 10, model: MODEL,
    });
    const r = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(r.source, "generated");
    assert.deepEqual(r.analysis.analysis.aspects_to_review, []);
    const row = await db("session_analyses").where("session_id", sessionRow.id).first();
    assert.deepEqual(row.analysis.aspects_to_review, []);
    // Los aspectos de seguimiento siguen siendo los follow_up determinísticos.
    assert.ok(Array.isArray(row.analysis.follow_up));
  });

  it("3.5: recomendación clínica 2 veces → failed, 2 llamadas, reason registrada sin texto del modelo", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return {
        text: JSON.stringify({
          schema_version: "3",
          summary: "La sesión fue completada; se recomienda consultar a un especialista.",
        }),
        raw: {}, latencyMs: 10, model: MODEL,
      };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID" && err.info?.reason === "clinical_recommendation"
    );
    assert.equal(calls, 2, "máximo 2 llamadas: no hay bucle");
    const rows = await db("session_analyses").where("session_id", sessionRow.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].analysis, null, "un análisis rechazado no se persiste como contenido");
    assert.match(rows[0].error_message, /^\[clinical_recommendation\]/);
  });

  it("3.5: contradicción con los datos 2 veces → failed contradicts_recorded_data", async () => {
    // La sesión tiene 2 correctas y 2 incorrectas: "más correctas" contradice.
    let calls = 0;
    const stub = async () => {
      calls++;
      return {
        text: JSON.stringify({
          schema_version: "3",
          summary: "La sesión fue completada y se registraron más respuestas correctas que incorrectas.",
        }),
        raw: {}, latencyMs: 10, model: MODEL,
      };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      (err) => err.code === "SCHEMA_INVALID" && err.info?.reason === "contradicts_recorded_data"
    );
    assert.equal(calls, 2);
  });

  it("3.5: regeneración rechazada conserva el análisis ok anterior", async () => {
    const okStub = async () => ({ text: validV3(), raw: {}, latencyMs: 10, model: MODEL });
    const first = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(okStub));
    assert.equal(first.source, "generated");

    let calls = 0;
    const badStub = async () => {
      calls++;
      return {
        text: JSON.stringify({ schema_version: "3", summary: "No se detectaron patologías en la sesión." }),
        raw: {}, latencyMs: 10, model: MODEL,
      };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(badStub)),
      (err) => err.info?.reason === "clinical_rule_out"
    );
    assert.equal(calls, 2);
    const rows = await db("session_analyses").where("session_id", sessionRow.id).orderBy("id");
    assert.deepEqual(rows.map((r) => r.status), ["ok", "failed"]);
    assert.equal(rows[0].id, first.analysis.id);
  });
});
