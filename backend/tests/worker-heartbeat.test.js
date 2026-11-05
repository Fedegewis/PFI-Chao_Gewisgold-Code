// Heartbeat del worker (renovación de lease).

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { addAnsweredQuestion } from "./helpers.js";

const VALID_TOKEN = "h".repeat(48);
process.env.WORKER_TOKEN = VALID_TOKEN;
process.env.WORKER_LEASE_MS = process.env.WORKER_LEASE_MS || "600000";
process.env.WORKER_RETRY_COOLDOWN_MS = process.env.WORKER_RETRY_COOLDOWN_MS || "0";
process.env.WORKER_MODEL = process.env.WORKER_MODEL || "llama3.2:3b";
process.env.AI_ENABLED = process.env.AI_ENABLED || "true";

const { default: app } = await import("../src/app.js");
const { default: db } = await import("../src/db/connection.js");
const { claimNextSession, renewLease } = await import("../src/services/ai/analysisQueue.js");

const stamp = Date.now();
let prof, patient, sectionRow;
const cleanupUserIds = [];
let testSessionIds = [];

async function makeCompletedSession() {
  const [session] = await db("sessions")
    .insert({
      patient_id: patient.id,
      professional_id: prof.id,
      status: "completed",
      started_at: new Date(Date.now() - 60000),
      completed_at: new Date(),
    })
    .returning("*");
  testSessionIds.push(session.id);
  const [ss] = await db("session_sections")
    .insert({ session_id: session.id, section_id: sectionRow.id, requested_count: 1, display_order: 1 })
    .returning("*");
  await addAnsweredQuestion(db, { sessionSectionId: ss.id, sectionId: sectionRow.id });
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

async function wipeTestSessions() {
  if (testSessionIds.length === 0) return;
  await db("sessions").whereIn("id", testSessionIds).del();
  testSessionIds = [];
}

describe("Worker heartbeat (renovación de lease)", () => {
  before(async () => {
    sectionRow = await db("sections").where({ slug: "atencion_visual" }).first();
    [prof] = await db("users")
      .insert({ role: "professional", name: "Dr HB", email: `hb-${stamp}@test.com` })
      .returning("*");
    [patient] = await db("users")
      .insert({ role: "patient", name: "Pac HB", email: `hb-pat-${stamp}@test.com`, professional_id: prof.id, age: 70 })
      .returning("*");
    cleanupUserIds.push(patient.id, prof.id);
  });

  after(async () => {
    await wipeTestSessions();
    if (cleanupUserIds.length > 0) {
      await db("users").whereIn("id", cleanupUserIds).del();
    }
    await db.destroy();
  });

  afterEach(async () => { await wipeTestSessions(); });

  describe("auth", () => {
    it("401 sin token", async () => {
      const res = await request(app).post("/api/worker/analysis/heartbeat").send({});
      assert.equal(res.status, 401);
    });

    it("401 con token incorrecto", async () => {
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", "Bearer bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        .send({});
      assert.equal(res.status, 401);
    });

    it("400 con shape inválido (claim_id ausente)", async () => {
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_token: "x" });
      assert.equal(res.status, 400);
    });

    it("400 con claim_token vacío", async () => {
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: 1, claim_token: "" });
      assert.equal(res.status, 400);
    });
  });

  describe("renovación", () => {
    it("Heartbeat válido extiende lease_expires_at", async () => {
      await makeCompletedSession();
      const claim = await claimNextSession();
      assert.ok(claim);
      const originalLease = new Date(claim.lease_expires_at).getTime();

      // Forzar que el lease original esté a punto de vencer para que el
      // delta sea observable, pero sin que haya expirado.
      const soonExpiry = new Date(Date.now() + 2000);
      await db("session_analyses")
        .where({ id: claim.claim_id })
        .update({ lease_expires_at: soonExpiry });

      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: claim.claim_id, claim_token: claim.claim_token });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.analysis_id, claim.claim_id);
      const renewed = new Date(res.body.lease_expires_at).getTime();
      assert.ok(renewed > soonExpiry.getTime(), "lease se extendió");
      assert.ok(renewed > Date.now() + 60 * 1000, "lease nuevo cubre más de 1 min");
      assert.ok(originalLease > 0); // smoke
    });

    it("Heartbeat con claim_token incorrecto → 409", async () => {
      await makeCompletedSession();
      const claim = await claimNextSession();
      assert.ok(claim);
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: claim.claim_id, claim_token: "wrong-token" });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, "CLAIM_LOST");
    });

    it("Heartbeat tras lease vencido → 409 (no revive un claim muerto)", async () => {
      await makeCompletedSession();
      const claim = await claimNextSession();
      assert.ok(claim);
      // Expirar el lease.
      await db("session_analyses")
        .where({ id: claim.claim_id })
        .update({ lease_expires_at: new Date(Date.now() - 1000) });
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: claim.claim_id, claim_token: claim.claim_token });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, "CLAIM_LOST");
      // La fila sigue en 'generating' con lease vencido (todavía no fue reaped).
      const row = await db("session_analyses").where({ id: claim.claim_id }).first();
      assert.equal(row.status, "generating");
      assert.ok(new Date(row.lease_expires_at).getTime() < Date.now(),
        "el lease no se extendió");
    });

    it("Heartbeat sobre un análisis OK → 409 (no modifica análisis completados)", async () => {
      await makeCompletedSession();
      const claim = await claimNextSession();
      assert.ok(claim);
      // Marcar la fila como ok manualmente.
      await db("session_analyses").where({ id: claim.claim_id }).update({
        status: "ok",
        analysis: {
          schema_version: "3", summary: "x", aspects_to_review: [],
          activities: [], evidence: [],
        },
        lease_expires_at: null,
        claim_token: null,
      });
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: claim.claim_id, claim_token: claim.claim_token });
      assert.equal(res.status, 409);
      // El análisis OK se preserva: ni analysis ni status cambian.
      const row = await db("session_analyses").where({ id: claim.claim_id }).first();
      assert.equal(row.status, "ok");
      assert.ok(row.analysis);
    });

    it("Heartbeat sobre un análisis failed → 409", async () => {
      await makeCompletedSession();
      const claim = await claimNextSession();
      assert.ok(claim);
      await db("session_analyses").where({ id: claim.claim_id }).update({
        status: "failed",
        error_code: "OLLAMA_OFFLINE",
        error_message: "forced",
        lease_expires_at: null,
        claim_token: null,
      });
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: claim.claim_id, claim_token: claim.claim_token });
      assert.equal(res.status, 409);
    });

    it("Heartbeat sobre claim_id inexistente → 409", async () => {
      const res = await request(app)
        .post("/api/worker/analysis/heartbeat")
        .set("Authorization", `Bearer ${VALID_TOKEN}`)
        .send({ claim_id: 999999999, claim_token: "whatever" });
      assert.equal(res.status, 409);
    });

    it("Concurrencia: dos heartbeats simultáneos sobre un lease vivo coexisten (ambos 200)", async () => {
      // Ambos ven la fila válida y hacen UPDATE condicional: ambos exitosos.
      // El UPDATE es idempotente (sólo cambia lease_expires_at); los dos
      // UPDATE commiten valores similares. Lo que importa es que el claim
      // sigue vivo tras el heartbeat.
      await makeCompletedSession();
      const claim = await claimNextSession();
      assert.ok(claim);
      const [a, b] = await Promise.all([
        request(app)
          .post("/api/worker/analysis/heartbeat")
          .set("Authorization", `Bearer ${VALID_TOKEN}`)
          .send({ claim_id: claim.claim_id, claim_token: claim.claim_token }),
        request(app)
          .post("/api/worker/analysis/heartbeat")
          .set("Authorization", `Bearer ${VALID_TOKEN}`)
          .send({ claim_id: claim.claim_id, claim_token: claim.claim_token }),
      ]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
    });

    it("renewLease (unidad) rechaza claim_id no entero", async () => {
      await assert.rejects(
        renewLease({ claimId: "abc", claimToken: "x" }),
        (err) => err?.code === "CLAIM_INVALID"
      );
    });

    it("renewLease (unidad) rechaza claim_token vacío", async () => {
      await assert.rejects(
        renewLease({ claimId: 1, claimToken: "" }),
        (err) => err?.code === "CLAIM_INVALID"
      );
    });
  });
});
