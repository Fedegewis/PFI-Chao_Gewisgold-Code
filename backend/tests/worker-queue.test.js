// W-1/W-2: cola FIFO global, concurrencia, lease, reintentos y validación.
//
// Usa DB real (menteactiva_test); fixtures con cleanup por CASCADE.

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

const VALID_TOKEN = "w".repeat(48);
process.env.WORKER_TOKEN = VALID_TOKEN;
// Default rápido para que los tests no dependan del env del dev.
process.env.WORKER_LEASE_MS = process.env.WORKER_LEASE_MS || "600000";
process.env.WORKER_MAX_GENERATION_ATTEMPTS = process.env.WORKER_MAX_GENERATION_ATTEMPTS || "3";
process.env.WORKER_MAX_TRANSIENT_ATTEMPTS = process.env.WORKER_MAX_TRANSIENT_ATTEMPTS || "20";
process.env.WORKER_RETRY_COOLDOWN_MS = process.env.WORKER_RETRY_COOLDOWN_MS || "0";
process.env.WORKER_MODEL = process.env.WORKER_MODEL || "llama3.2:3b";
process.env.AI_ENABLED = process.env.AI_ENABLED || "true";

const { default: app } = await import("../src/app.js");
const { default: db } = await import("../src/db/connection.js");
const {
  claimNextSession,
} = await import("../src/services/ai/analysisQueue.js");
const {
  PROMPT_BUILDER_VERSION,
} = await import("../src/services/ai/promptBuilder.js");
const {
  ANALYSIS_SCHEMA_VERSION,
} = await import("../src/services/ai/responseValidator.js");

const CURRENT_MODEL = process.env.WORKER_MODEL;
const CURRENT_SCHEMA = ANALYSIS_SCHEMA_VERSION;
const CURRENT_PROMPT = PROMPT_BUILDER_VERSION;

// ---------- Fixtures ----------

const stamp = Date.now();
let profA, profB, patientA, patientB, sectionRow;
const cleanupUserIds = [];
let testSessionIds = [];

async function makeCompletedSession(patient, professional, completedAt) {
  const [session] = await db("sessions")
    .insert({
      patient_id: patient.id,
      professional_id: professional.id,
      status: "completed",
      started_at: new Date(completedAt.getTime() - 60000),
      completed_at: completedAt,
    })
    .returning("*");
  testSessionIds.push(session.id);
  const [ss] = await db("session_sections")
    .insert({ session_id: session.id, section_id: sectionRow.id, requested_count: 1, display_order: 1 })
    .returning("*");
  const [q] = await db("questions")
    .where({ section_id: sectionRow.id, is_active: true })
    .orderBy("id").limit(1).select("*");
  await db("session_questions").insert({
    session_section_id: ss.id, question_id: q.id, display_order: 1,
    prompt_snapshot: q.prompt, options_snapshot: JSON.stringify(q.options),
    correct_answer_snapshot: q.correct_answer ?? 0, response_type: q.response_type,
  });
  await db("session_results").insert({
    session_id: session.id, section_id: sectionRow.id,
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

function validRawText() {
  return JSON.stringify({
    schema_version: "3",
    // Paráfrasis anclada a las observaciones determinísticas de la sesión
    // (el validador exige anclaje desde la auditoría 2026-11-04).
    summary: "La sesión de entrenamiento fue completada en su totalidad.",
    aspects_to_review: [],
  });
}

async function wipeTestSessions() {
  if (testSessionIds.length === 0) return;
  // CASCADE elimina session_sections, session_questions, session_results y session_analyses.
  await db("sessions").whereIn("id", testSessionIds).del();
  testSessionIds = [];
}

describe("Worker queue (claim/result/failed)", () => {
  before(async () => {
    sectionRow = await db("sections").where({ slug: "atencion_visual" }).first();
    [profA] = await db("users")
      .insert({ role: "professional", name: "Dr Worker A", email: `w-a-${stamp}@test.com` })
      .returning("*");
    [profB] = await db("users")
      .insert({ role: "professional", name: "Dr Worker B", email: `w-b-${stamp}@test.com` })
      .returning("*");
    [patientA] = await db("users")
      .insert({ role: "patient", name: "Pac Worker A", email: `w-pat-a-${stamp}@test.com`, professional_id: profA.id, age: 70 })
      .returning("*");
    [patientB] = await db("users")
      .insert({ role: "patient", name: "Pac Worker B", email: `w-pat-b-${stamp}@test.com`, professional_id: profB.id, age: 72 })
      .returning("*");
    cleanupUserIds.push(patientA.id, patientB.id, profB.id, profA.id);
  });

  after(async () => {
    await wipeTestSessions();
    if (cleanupUserIds.length > 0) {
      await db("users").whereIn("id", cleanupUserIds).del();
    }
    await db.destroy();
  });

  afterEach(async () => {
    // Aislamiento total entre casos: cada test crea sus propias sesiones
    // y las elimina. CASCADE limpia session_analyses asociado.
    await wipeTestSessions();
  });

  it("FIFO entre distintos psicólogos: devuelve la sesión más antigua primero", async () => {
    const older = await makeCompletedSession(patientA, profA, new Date(Date.now() - 60 * 60 * 1000));
    const newer = await makeCompletedSession(patientB, profB, new Date());

    const first = await claimNextSession();
    assert.ok(first, "esperaba un claim");
    assert.equal(first.session_id, older.id, "la más antigua gana por FIFO global");
    assert.equal(first.model, CURRENT_MODEL);
    assert.equal(first.schema_version, CURRENT_SCHEMA);
    assert.equal(first.prompt_version, CURRENT_PROMPT);
    assert.ok(typeof first.prompt === "string" && first.prompt.length > 0);
    assert.ok(typeof first.claim_token === "string" && first.claim_token.length > 0);

    // El prompt NO contiene PII (nombres de pacientes/profesionales ni emails).
    assert.ok(!first.prompt.includes("Pac Worker"), "no PII en el prompt");
    assert.ok(!first.prompt.includes("Dr Worker"), "no PII en el prompt");
    assert.ok(!first.prompt.includes("@test.com"), "no PII en el prompt");

    // W-3: GLOBAL_CONCURRENCY=1 impide un segundo claim mientras el primero
    // tiene lease vivo. Simulamos que el worker cerró el primero (ok) para
    // liberar la cola y poder reclamar la siguiente en FIFO.
    await db("session_analyses").where({ id: first.claim_id }).update({
      status: "ok",
      analysis: {
        schema_version: "3", summary: "x", aspects_to_review: [],
        activities: [], evidence: [],
      },
      lease_expires_at: null, claim_token: null,
    });

    const second = await claimNextSession();
    assert.ok(second);
    assert.equal(second.session_id, newer.id);

    // Antes del tercer intento también cerramos el segundo para no quedar
    // bloqueados por concurrencia global.
    await db("session_analyses").where({ id: second.claim_id }).update({
      status: "ok",
      analysis: {
        schema_version: "3", summary: "x", aspects_to_review: [],
        activities: [], evidence: [],
      },
      lease_expires_at: null, claim_token: null,
    });
    const third = await claimNextSession();
    assert.equal(third, null, "no quedan más");
  });

  it("Concurrencia GLOBAL atómica: con DOS sesiones elegibles y DOS claims en paralelo, sólo uno gana", async () => {
    // Regresión W-3-FIX: antes del advisory lock global, dos tx podían
    // leer COUNT=0 al mismo tiempo y emitir claim sobre sesiones distintas.
    // Con el lock global, exactamente una emite claim y la otra recibe null.
    const olderCompleted = new Date(Date.now() - 60 * 60 * 1000);
    const s1 = await makeCompletedSession(patientA, profA, olderCompleted);
    const s2 = await makeCompletedSession(patientB, profB, new Date());
    const [a, b] = await Promise.all([claimNextSession(), claimNextSession()]);
    const winners = [a, b].filter((x) => x !== null);
    const losers = [a, b].filter((x) => x === null);
    assert.equal(winners.length, 1, "exactamente un claim ganador global");
    assert.equal(losers.length, 1, "el otro recibe null (bloqueo global)");
    // Y el ganador es siempre la sesión FIFO más antigua.
    assert.equal(winners[0].session_id, s1.id, "FIFO respetado bajo el lock global");
    assert.ok(s2.id); // smoke
  });

  it("Concurrencia GLOBAL: mientras hay un lease vivo, el siguiente claim recibe null", async () => {
    const olderCompleted = new Date(Date.now() - 60 * 60 * 1000);
    const s1 = await makeCompletedSession(patientA, profA, olderCompleted);
    const s2 = await makeCompletedSession(patientB, profB, new Date());
    const first = await claimNextSession();
    assert.ok(first);
    assert.equal(first.session_id, s1.id);
    // Segundo intento mientras el primero sigue vivo: null (default GLOBAL=1).
    const blocked = await claimNextSession();
    assert.equal(blocked, null, "la cola serializa: no se emite claim nuevo");
    // Al cerrar el primero, el segundo claim toma s2.
    await db("session_analyses").where({ id: first.claim_id }).update({
      status: "ok",
      analysis: {
        schema_version: "3", summary: "x", aspects_to_review: [],
        activities: [], evidence: [],
      },
      lease_expires_at: null, claim_token: null,
    });
    const second = await claimNextSession();
    assert.ok(second);
    assert.equal(second.session_id, s2.id);
  });

  it("Sesiones ya analizadas con ok para la triple actual no se reclaman", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    await db("session_analyses").insert({
      session_id: s.id,
      status: "ok",
      model: CURRENT_MODEL,
      schema_version: CURRENT_SCHEMA,
      prompt_version: CURRENT_PROMPT,
      analysis: {
        schema_version: "3",
        summary: "x",
        aspects_to_review: [],
        activities: [], evidence: [],
      },
    });
    const claim = await claimNextSession();
    assert.equal(claim, null, "una sesión con ok existente no se reclama");
  });

  async function insertOkFor(sessionId, { model, promptVersion }) {
    await db("session_analyses").insert({
      session_id: sessionId,
      status: "ok",
      model,
      schema_version: CURRENT_SCHEMA,
      prompt_version: promptVersion,
      analysis: {
        schema_version: "3",
        summary: "x",
        aspects_to_review: [],
        activities: [], evidence: [],
      },
    });
  }

  // Fase 2 (2026-11-04): por defecto la cola NO regenera automáticamente
  // análisis ok de otra versión (modelo/prompt). Si lo hiciera, subir
  // PROMPT_VERSION regeneraría todo el historial sin autorización. La
  // regeneración es explícita (scripts/regenerate-analyses.js) o con
  // WORKER_REGENERATE_OUTDATED_ANALYSES=true.
  it("Sesión con ok de OTRO modelo NO se reclama por defecto", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    await insertOkFor(s.id, { model: "otro-modelo", promptVersion: CURRENT_PROMPT });
    const claim = await claimNextSession();
    assert.equal(claim, null);
  });

  it("Sesión con ok de un prompt ANTERIOR NO se reclama por defecto", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    await insertOkFor(s.id, { model: "llama3.2:3b", promptVersion: "3.4" });
    const claim = await claimNextSession();
    assert.equal(claim, null);
  });

  it("Con REGENERATE_OUTDATED=true, una sesión con ok de OTRO modelo sí se reclama", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    await insertOkFor(s.id, { model: "otro-modelo", promptVersion: CURRENT_PROMPT });
    const claim = await claimNextSession({ configOverrides: { REGENERATE_OUTDATED: true } });
    assert.ok(claim);
    assert.equal(claim.session_id, s.id);
  });

  it("Con REGENERATE_OUTDATED=true, una sesión con ok de un prompt ANTERIOR sí se reclama", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    await insertOkFor(s.id, { model: "llama3.2:3b", promptVersion: "3.4" });
    const claim = await claimNextSession({ configOverrides: { REGENERATE_OUTDATED: true } });
    assert.ok(claim);
    assert.equal(claim.session_id, s.id);
  });

  it("Concurrencia: dos claims simultáneos sobre una única sesión no colisionan", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const [a, b] = await Promise.all([claimNextSession(), claimNextSession()]);
    const winners = [a, b].filter((x) => x && x.session_id === s.id);
    const losers = [a, b].filter((x) => x === null);
    assert.equal(winners.length, 1, "exactamente un worker gana");
    assert.equal(losers.length, 1, "el otro recibe null (sin trabajo)");
  });

  it("Resultado de un claim con lease vencido es rechazado (409 CLAIM_LOST)", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    // Forzar lease vencido: hacer que lease_expires_at esté en el pasado.
    await db("session_analyses")
      .where({ id: claim.claim_id })
      .update({ lease_expires_at: new Date(Date.now() - 60 * 1000) });
    const res = await request(app)
      .post("/api/worker/analysis/result")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ claim_id: claim.claim_id, claim_token: claim.claim_token, raw_text: validRawText() });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "CLAIM_LOST");
    // La sesión queda disponible para re-claim por un worker nuevo.
    assert.ok(s.id);
  });

  it("Resultado con claim_token incorrecto es rechazado (409)", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const res = await request(app)
      .post("/api/worker/analysis/result")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ claim_id: claim.claim_id, claim_token: "wrong", raw_text: validRawText() });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "CLAIM_LOST");
  });

  it("Lease vencido es recuperable por otro claim (reclaim)", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const first = await claimNextSession();
    assert.ok(first);
    // Expirar el lease del primer claim.
    await db("session_analyses")
      .where({ id: first.claim_id })
      .update({ lease_expires_at: new Date(Date.now() - 1000) });
    // Un segundo claim debe tomarla.
    const second = await claimNextSession();
    assert.ok(second);
    assert.equal(second.session_id, s.id);
    assert.notEqual(second.claim_id, first.claim_id);
    assert.notEqual(second.claim_token, first.claim_token);
  });

  it("Validación server-side: raw_text con JSON inválido → 422 (no persiste ok)", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const res = await request(app)
      .post("/api/worker/analysis/result")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ claim_id: claim.claim_id, claim_token: claim.claim_token, raw_text: "not json" });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, "VALIDATION_FAILED");
    // Fila cerrada como failed.
    const row = await db("session_analyses").where({ id: claim.claim_id }).first();
    assert.equal(row.status, "failed");
    assert.ok(row.error_code);
    assert.equal(row.lease_expires_at, null);
    assert.equal(row.claim_token, null);
    // La sesión sigue existiendo.
    assert.ok(s.id);
  });

  it("Validación server-side: raw_text con término clínico prohibido → 422 retriable=true", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const forbidden = JSON.stringify({
      schema_version: "3",
      summary: "Se observó deterioro cognitivo durante la actividad.",
      aspects_to_review: [],
    });
    const res = await request(app)
      .post("/api/worker/analysis/result")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ claim_id: claim.claim_id, claim_token: claim.claim_token, raw_text: forbidden });
    assert.equal(res.status, 422);
    assert.equal(res.body.retriable, true);
  });

  // Fase 2: el worker (modo deferred) aplica EXACTAMENTE la misma política
  // que el camino in-process (GENERATION_VALIDATION_OPTIONS). Mismos textos,
  // mismas reasons que en ai-analysis-retry.test.js.
  for (const [label, summary, reason] of [
    ["descarte clínico", "No se detectaron patologías ni condiciones clínicas en esta sesión aislada.", "clinical_rule_out"],
    ["recomendación clínica", "La sesión fue completada; se recomienda consultar a un especialista.", "clinical_recommendation"],
    // La sesión del fixture tiene 1 correcta y 0 incorrectas.
    ["contradicción con los datos", "La sesión fue completada y se registraron más respuestas incorrectas que correctas.", "contradicts_recorded_data"],
  ]) {
    it(`Paridad deferred: ${label} → 422 retriable, failed con [${reason}] y sin contenido`, async () => {
      await makeCompletedSession(patientA, profA, new Date());
      const claim = await claimNextSession();
      assert.ok(claim);
      const res = await request(app)
        .post("/api/worker/analysis/result")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({
          claim_id: claim.claim_id,
          claim_token: claim.claim_token,
          raw_text: JSON.stringify({ schema_version: "3", summary }),
        });
      assert.equal(res.status, 422);
      assert.equal(res.body.retriable, true);
      // La respuesta al worker no devuelve el texto del modelo.
      assert.ok(!JSON.stringify(res.body).includes(summary));
      const row = await db("session_analyses").where({ id: claim.claim_id }).first();
      assert.equal(row.status, "failed");
      assert.equal(row.analysis, null);
      assert.ok(row.error_message.startsWith(`[${reason}]`), row.error_message);
    });
  }

  it("Paridad deferred: aspects_to_review del modelo se descarta al persistir", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const res = await request(app)
      .post("/api/worker/analysis/result")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        claim_id: claim.claim_id,
        claim_token: claim.claim_token,
        raw_text: JSON.stringify({
          schema_version: "3",
          summary: "La sesión de entrenamiento fue completada en su totalidad.",
          aspects_to_review: ["Se recomienda derivar a un especialista."],
        }),
      });
    assert.equal(res.status, 200);
    const row = await db("session_analyses").where({ id: claim.claim_id }).first();
    assert.equal(row.status, "ok");
    assert.deepEqual(row.analysis.aspects_to_review, []);
    assert.ok(Array.isArray(row.analysis.follow_up));
  });

  it("Validación OK: persiste status=ok con activities + evidence + observations + follow_up", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const res = await request(app)
      .post("/api/worker/analysis/result")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        claim_id: claim.claim_id,
        claim_token: claim.claim_token,
        raw_text: validRawText(),
        latency_ms: 1234,
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const row = await db("session_analyses").where({ id: claim.claim_id }).first();
    assert.equal(row.status, "ok");
    assert.equal(row.model, CURRENT_MODEL);
    assert.equal(row.schema_version, CURRENT_SCHEMA);
    assert.equal(row.prompt_version, CURRENT_PROMPT);
    assert.equal(Number(row.latency_ms), 1234);
    const persisted = row.analysis;
    assert.equal(persisted.schema_version, "3");
    assert.ok(typeof persisted.summary === "string" && persisted.summary.length > 0);
    assert.ok(Array.isArray(persisted.activities));
    assert.ok(Array.isArray(persisted.evidence));
    assert.ok(Array.isArray(persisted.observations));
    assert.ok(Array.isArray(persisted.follow_up));
    // Lease liberado.
    assert.equal(row.lease_expires_at, null);
    assert.equal(row.claim_token, null);
  });

  it("Reintentos de GENERACIÓN: tras MAX_GENERATION_ATTEMPTS la sesión sale de la cola", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const max = Number(process.env.WORKER_MAX_GENERATION_ATTEMPTS);
    for (let i = 0; i < max; i++) {
      await db("session_analyses").insert({
        session_id: s.id,
        status: "failed",
        model: CURRENT_MODEL,
        schema_version: CURRENT_SCHEMA,
        prompt_version: CURRENT_PROMPT,
        error_code: "ANALYSIS_SCHEMA_INVALID",
        error_message: `generation attempt ${i + 1}`,
        attempt_count: i,
      });
    }
    const claim = await claimNextSession();
    assert.equal(claim, null, "no se reclama tras agotar intentos de generación");
  });

  it("Reintentos TRANSITORIOS: fallos de Ollama no agotan la cuota de generación", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    // Insertar más fallos transitorios que MAX_GENERATION_ATTEMPTS (3).
    // Si el bucketing fuera incorrecto, esta sesión saldría de la cola.
    for (let i = 0; i < 5; i++) {
      await db("session_analyses").insert({
        session_id: s.id,
        status: "failed",
        model: CURRENT_MODEL,
        schema_version: CURRENT_SCHEMA,
        prompt_version: CURRENT_PROMPT,
        error_code: "OLLAMA_OFFLINE",
        error_message: `transient attempt ${i + 1}`,
        attempt_count: i,
      });
    }
    const claim = await claimNextSession();
    assert.ok(claim, "una sesión con fallos sólo transitorios sigue siendo reclamable");
    assert.equal(claim.session_id, s.id);
  });

  it("Reintentos TRANSITORIOS: cap defensivo tras MAX_TRANSIENT_ATTEMPTS", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const transientMax = Number(process.env.WORKER_MAX_TRANSIENT_ATTEMPTS);
    for (let i = 0; i < transientMax; i++) {
      await db("session_analyses").insert({
        session_id: s.id,
        status: "failed",
        model: CURRENT_MODEL,
        schema_version: CURRENT_SCHEMA,
        prompt_version: CURRENT_PROMPT,
        error_code: "OLLAMA_TIMEOUT",
        error_message: `transient attempt ${i + 1}`,
        attempt_count: i,
      });
    }
    const claim = await claimNextSession();
    assert.equal(claim, null, "a este punto el cap transient también protege");
  });

  it("Lease vencido sin reporte → reaper lo convierte en failed(ANALYSIS_LEASE_EXPIRED) y la sesión sigue reclamable", async () => {
    const s = await makeCompletedSession(patientA, profA, new Date());
    const first = await claimNextSession();
    assert.ok(first);
    // Simular crash del worker: expirar lease sin reporte.
    await db("session_analyses")
      .where({ id: first.claim_id })
      .update({ lease_expires_at: new Date(Date.now() - 1000) });

    const second = await claimNextSession();
    assert.ok(second, "la sesión vuelve a estar disponible");
    assert.equal(second.session_id, s.id);
    // La fila original quedó failed con el código correcto (reaper).
    const reaped = await db("session_analyses").where({ id: first.claim_id }).first();
    assert.equal(reaped.status, "failed");
    assert.equal(reaped.error_code, "ANALYSIS_LEASE_EXPIRED");
    assert.equal(reaped.lease_expires_at, null);
    assert.equal(reaped.claim_token, null);
  });

  it("Lease vencido NO consume cuota de generación", async () => {
    // Varias caídas del worker (lease expirados) no deben sacar la sesión
    // de la cola. ANALYSIS_LEASE_EXPIRED se clasifica como transient.
    const s = await makeCompletedSession(patientA, profA, new Date());
    for (let i = 0; i < 5; i++) {
      await db("session_analyses").insert({
        session_id: s.id,
        status: "failed",
        model: CURRENT_MODEL,
        schema_version: CURRENT_SCHEMA,
        prompt_version: CURRENT_PROMPT,
        error_code: "ANALYSIS_LEASE_EXPIRED",
        error_message: "lease expirado simulado",
      });
    }
    const claim = await claimNextSession();
    assert.ok(claim, "lease_expired no debe agotar la cuota de generación");
    assert.equal(claim.session_id, s.id);
  });

  it("Failed con error_code permitido actualiza fila y libera lease", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const res = await request(app)
      .post("/api/worker/analysis/failed")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        claim_id: claim.claim_id,
        claim_token: claim.claim_token,
        error_code: "OLLAMA_TIMEOUT",
        error_message: "exceeded 150s",
      });
    assert.equal(res.status, 200);
    const row = await db("session_analyses").where({ id: claim.claim_id }).first();
    assert.equal(row.status, "failed");
    assert.equal(row.error_code, "OLLAMA_TIMEOUT");
    assert.equal(row.lease_expires_at, null);
    assert.equal(row.claim_token, null);
  });

  it("Failed con error_code NO permitido es rechazado (400)", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const claim = await claimNextSession();
    assert.ok(claim);
    const res = await request(app)
      .post("/api/worker/analysis/failed")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        claim_id: claim.claim_id,
        claim_token: claim.claim_token,
        error_code: "ANALYSIS_SCHEMA_INVALID", // family analysis, no permitida al worker
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "ERROR_CODE_INVALID");
    // Fila sigue generating con el claim original.
    const row = await db("session_analyses").where({ id: claim.claim_id }).first();
    assert.equal(row.status, "generating");
  });

  it("Endpoint /claim responde 204 cuando la cola está vacía", async () => {
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    assert.equal(res.status, 204);
  });

  it("Endpoint /claim devuelve payload con prompt y claim_token válidos", async () => {
    await makeCompletedSession(patientA, profA, new Date());
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.claim_id);
    assert.ok(res.body.claim_token);
    assert.ok(res.body.prompt);
    assert.equal(res.body.model, CURRENT_MODEL);
    assert.equal(res.body.schema_version, CURRENT_SCHEMA);
    assert.equal(res.body.prompt_version, CURRENT_PROMPT);
    assert.ok(res.body.lease_expires_at);
  });
});
