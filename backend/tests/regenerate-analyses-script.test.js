// scripts/regenerate-analyses.js — listado de revisión (dry-run).
//
// Verifica que el listado:
//  - toma sólo el último análisis ok de cada sesión completada;
//  - marca como no conforme el texto que no cumple las reglas vigentes;
//  - devuelve sólo columnas técnicas (sin texto del modelo ni datos personales);
//  - no modifica la base.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import db from "../src/db/connection.js";
import { reviewStoredAnalysis } from "../src/services/ai/contentSafety.js";
import { listAnalysesForReview } from "../scripts/regenerate-analyses.js";

const EMAIL_SUFFIX = "@regenerate-script.test.com";
let prof, patient, sectionRow;
const sessionIds = [];

async function cleanup() {
  const pids = db("users").select("id").where("email", "like", `%${EMAIL_SUFFIX}`);
  const sids = await db("sessions").whereIn("patient_id", pids).pluck("id");
  if (sids.length > 0) {
    await db("session_analyses").whereIn("session_id", sids).del();
    await db("session_sections").whereIn("session_id", sids).del();
    await db("sessions").whereIn("id", sids).del();
  }
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function makeSession(status = "completed") {
  const [s] = await db("sessions").insert({
    patient_id: patient.id, professional_id: prof.id, status,
    started_at: new Date(), completed_at: status === "completed" ? new Date() : null,
  }).returning("*");
  sessionIds.push(s.id);
  return s;
}

async function insertAnalysis(sessionId, { status = "ok", summary, promptVersion = "3.4", createdAt = new Date() }) {
  const [row] = await db("session_analyses").insert({
    session_id: sessionId, status, model: "llama3.2:3b",
    schema_version: "3", prompt_version: promptVersion, created_at: createdAt,
    analysis: status === "ok"
      ? { schema_version: "3", summary, aspects_to_review: [], activities: [], evidence: [] }
      : null,
    error_code: status === "failed" ? "SCHEMA_INVALID" : null,
  }).returning("*");
  return row;
}

describe("regenerate-analyses — listAnalysesForReview (dry-run)", () => {
  before(async () => {
    await cleanup();
    const stamp = Date.now();
    [prof] = await db("users").insert({ role: "professional", name: "Prof S", email: `prof-${stamp}${EMAIL_SUFFIX}` }).returning("*");
    [patient] = await db("users").insert({
      role: "patient", name: "Pat S", email: `pat-${stamp}${EMAIL_SUFFIX}`, professional_id: prof.id, age: 70,
    }).returning("*");
    sectionRow = await db("sections").first();
    assert.ok(sectionRow);
  });

  after(async () => {
    await cleanup();
    await db.destroy();
  });

  it("lista el último ok por sesión, marca no conformes y no expone texto", async () => {
    const unsafe = await makeSession();
    const safe = await makeSession();
    const notCompleted = await makeSession("in_progress");

    const old = new Date(Date.now() - 60_000);
    await insertAnalysis(unsafe.id, { summary: "La sesión fue completada en su totalidad.", createdAt: old });
    const latestUnsafe = await insertAnalysis(unsafe.id, { summary: "No se detectaron patologías ni condiciones clínicas en esta sesión aislada." });
    await insertAnalysis(unsafe.id, { status: "failed" });
    const latestSafe = await insertAnalysis(safe.id, { summary: "La sesión fue completada en su totalidad.", promptVersion: "3.5" });
    await insertAnalysis(notCompleted.id, { summary: "No se detectaron patologías." });

    const before = await db("session_analyses").whereIn("session_id", sessionIds).count("* as n").first();
    const list = await listAnalysesForReview(db, { reviewStoredAnalysis });
    const after = await db("session_analyses").whereIn("session_id", sessionIds).count("* as n").first();
    assert.equal(after.n, before.n, "dry-run no modifica la base");

    const mine = list.filter((r) => sessionIds.includes(r.session_id));
    assert.equal(mine.length, 2, "sólo sesiones completadas, una fila por sesión");

    const u = mine.find((r) => r.session_id === unsafe.id);
    assert.equal(u.analysis_id, latestUnsafe.id);
    assert.equal(u.compliant, false);
    assert.ok(u.reasons.includes("clinical_rule_out"));

    const s = mine.find((r) => r.session_id === safe.id);
    assert.equal(s.analysis_id, latestSafe.id);
    assert.equal(s.compliant, true);
    assert.equal(s.prompt_version, "3.5");

    for (const r of mine) {
      assert.deepEqual(
        Object.keys(r).sort(),
        ["analysis_id", "compliant", "model", "prompt_version", "reasons", "schema_version", "session_id"],
      );
    }
  });
});
