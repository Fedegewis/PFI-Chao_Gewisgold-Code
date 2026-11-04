// Integración del mecanismo adaptativo de dificultad con la API real
// (POST /api/patient/sessions → start → answers → complete), usando sólo
// fixtures sintéticas propias en la DB de tests.
//
// Todas las preguntas de fixture tienen correct_answer = 0: responder 0 es
// correcto y 1 es incorrecto. Así cada sesión produce exactamente la
// precisión que el escenario necesita.

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import knex from "knex";
import app from "../src/app.js";
import db, { knexConfig } from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import { resetAutoAnalysisTrigger, setAutoAnalysisTrigger } from "../src/routes/sessions.js";
import { computeAdaptiveLevel } from "../src/services/adaptiveDifficulty.js";

const EMAIL_SUFFIX = "@adaptive-difficulty-test.com";
const SECTION_PREFIX = `adapt_${Date.now()}`;
const SOURCE = "adaptive_difficulty_fixture";

async function cleanup() {
  const ids = await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).pluck("id");
  if (ids.length) await db("sessions").whereIn("patient_id", ids).del();
  const qids = await db("questions").where("source", SOURCE).pluck("id");
  if (qids.length) {
    await db("question_cognitive_domains").whereIn("question_id", qids).del();
    await db("questions").whereIn("id", qids).del();
  }
  await db("sections").where("slug", "like", `${SECTION_PREFIX}_%`).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

let seq = 0;
async function createPatient(prof, extra = {}) {
  seq += 1;
  const [p] = await db("users").insert({
    role: "patient",
    name: `Paciente Adapt ${seq}`,
    email: `pac-${seq}-${Date.now()}${EMAIL_SUFFIX}`,
    professional_id: prof.id,
    max_questions: 4,
    ...extra,
  }).returning("*");
  return { patient: p, auth: authHeaderFor(p) };
}

async function createSection(suffix, counts, { atencionEvery = 0 } = {}) {
  const [section] = await db("sections").insert({
    slug: `${SECTION_PREFIX}_${suffix}`, name: `Adapt ${suffix}`, description: "fixture", is_active: true, display_order: 950,
  }).returning("*");
  const [memoria] = await db("cognitive_domains").where({ slug: "memoria" }).select("id");
  const [atencion] = await db("cognitive_domains").where({ slug: "atencion" }).select("id");
  let n = 0;
  for (const [difficulty, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const [q] = await db("questions").insert({
        section_id: section.id,
        prompt: `${suffix}-d${difficulty}-${i} ¿Pregunta sintética de fixture?`,
        response_type: "multiple_choice",
        options: JSON.stringify(["A", "B", "C", "D"]),
        correct_answer: 0,
        difficulty: Number(difficulty),
        is_active: true,
        is_validated: false,
        validation_level: "technical",
        source: SOURCE,
      }).returning("*");
      const withAtencion = atencionEvery > 0 && n % atencionEvery === 0;
      await db("question_cognitive_domains").insert({
        question_id: q.id, cognitive_domain_id: withAtencion ? atencion.id : memoria.id,
      });
    }
  }
  return section;
}

async function createSession(auth, slug, body = {}) {
  return request(app).post("/api/patient/sessions").set("Authorization", auth)
    .send({ sections: [{ section_slug: slug }], ...body });
}

// Crea y ejecuta una sesión: `correct` respuestas correctas, el resto incorrectas.
async function runSession(auth, slug, correct, { finish = "complete" } = {}) {
  const res = await createSession(auth, slug);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const sessionId = res.body.id;
  const questions = res.body.sections[0].questions;
  await request(app).post(`/api/sessions/${sessionId}/start`).set("Authorization", auth).expect(200);
  if (finish === "abandon") {
    await request(app).post(`/api/sessions/${sessionId}/abandon`).set("Authorization", auth).expect(200);
    return sessionId;
  }
  for (let i = 0; i < questions.length; i += 1) {
    await request(app).post(`/api/sessions/${sessionId}/answers`).set("Authorization", auth).send({
      session_question_id: questions[i].id,
      selected_answer: i < correct ? 0 : 1,
      response_time_ms: 1500,
    }).expect(201);
  }
  if (finish === "complete") {
    await request(app).post(`/api/sessions/${sessionId}/complete`).set("Authorization", auth).expect(200);
  }
  return sessionId;
}

async function adaptiveOf(sessionId) {
  const ss = await db("session_sections").where({ session_id: sessionId }).first();
  const qs = await db("session_questions").where({ session_section_id: ss.id }).select("question_id", "difficulty_snapshot");
  return { level: ss.adaptive_level, decision: ss.adaptive_decision, version: ss.adaptive_version, questions: qs };
}

describe("Mecanismo adaptativo de dificultad — integración", { concurrency: false }, () => {
  let prof, profAuth, otherProfAuth;
  let secA, secB, secSmall, secFewHard;

  before(async () => {
    await cleanup();
    [prof] = await db("users").insert({ role: "professional", name: "Prof Adapt", email: `prof-${Date.now()}${EMAIL_SUFFIX}` }).returning("*");
    const [other] = await db("users").insert({ role: "professional", name: "Prof Otro", email: `prof2-${Date.now()}${EMAIL_SUFFIX}` }).returning("*");
    profAuth = authHeaderFor(prof);
    otherProfAuth = authHeaderFor(other);
    secA = await createSection("a", { 1: 12, 2: 12, 3: 12 }, { atencionEvery: 3 });
    secB = await createSection("b", { 1: 12, 2: 12, 3: 12 });
    secSmall = await createSection("small", { 1: 1, 2: 1, 3: 1 });
    secFewHard = await createSection("fewhard", { 1: 10, 2: 10, 3: 1 });
  });

  afterEach(() => resetAutoAnalysisTrigger());

  after(async () => {
    await cleanup();
  });

  it("paciente nuevo: nivel inicial 2, mezcla 1/2/1 y snapshots persistidos", async () => {
    const { auth } = await createPatient(prof);
    const id = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a = await adaptiveOf(id);
    assert.equal(a.level, 2);
    assert.equal(a.version, "1");
    assert.equal(a.decision.rule, "initial_level");
    assert.deepEqual(a.decision.selection.targets, { 1: 1, 2: 2, 3: 1 });
    assert.deepEqual(a.decision.selection.actual_mix, { 1: 1, 2: 2, 3: 1 });
    assert.equal(a.questions.length, 4);
    assert.ok(a.questions.every((q) => [1, 2, 3].includes(q.difficulty_snapshot)));
  });

  it("alto desempeño sostenido: sube a 3 con la evidencia de dos sesiones y se mantiene en el tope", async () => {
    const { auth } = await createPatient(prof);
    const s1 = await runSession(auth, secA.slug, 4);
    const s2 = await runSession(auth, secA.slug, 4);
    const s3 = await runSession(auth, secA.slug, 4);
    const a3 = await adaptiveOf(s3);
    assert.equal(a3.level, 3);
    assert.equal(a3.decision.change, "up");
    assert.deepEqual(a3.decision.evidence.session_ids, [s2, s1]);
    assert.deepEqual(a3.decision.selection.actual_mix, { 1: 0, 2: 1, 3: 3 });
    // Una sola sesión en nivel 3: evidencia insuficiente (ventana reiniciada).
    const s4 = await runSession(auth, secA.slug, 4);
    assert.equal((await adaptiveOf(s4)).decision.rule, "insufficient_evidence");
    const s5 = await runSession(auth, secA.slug, 4, { finish: "none" });
    const a5 = await adaptiveOf(s5);
    assert.equal(a5.level, 3);
    assert.equal(a5.decision.rule, "max_level_reached");
  });

  it("bajo desempeño sostenido: baja a 1 y se mantiene en el mínimo", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 1);
    await runSession(auth, secA.slug, 1);
    const s3 = await runSession(auth, secA.slug, 0);
    const a3 = await adaptiveOf(s3);
    assert.equal(a3.level, 1);
    assert.equal(a3.decision.change, "down");
    assert.deepEqual(a3.decision.selection.actual_mix, { 1: 3, 2: 1, 3: 0 });
    await runSession(auth, secA.slug, 0);
    const s5 = await runSession(auth, secA.slug, 0, { finish: "none" });
    assert.equal((await adaptiveOf(s5)).decision.rule, "min_level_reached");
  });

  it("rendimiento mixto (5/8): se mantiene en nivel 2", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 2);
    await runSession(auth, secA.slug, 3);
    const s3 = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a = await adaptiveOf(s3);
    assert.equal(a.level, 2);
    assert.equal(a.decision.rule, "intermediate_accuracy");
    assert.equal(a.decision.evidence.accuracy, 0.625);
  });

  it("evidencia insuficiente tras una sola sesión completa", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 4);
    const s2 = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a = await adaptiveOf(s2);
    assert.equal(a.level, 2);
    assert.equal(a.decision.rule, "insufficient_evidence");
  });

  it("ventana reiniciada y cambio máximo de un nivel: tras subir, dos sesiones bajas vuelven a 2 (no a 1)", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 4);
    await runSession(auth, secA.slug, 4);
    await runSession(auth, secA.slug, 0); // nivel 3
    const s4 = await runSession(auth, secA.slug, 0); // nivel 3, una sola evidencia en 3
    assert.equal((await adaptiveOf(s4)).level, 3);
    const s5 = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a5 = await adaptiveOf(s5);
    assert.equal(a5.level, 2);
    assert.equal(a5.decision.change, "down");
  });

  it("sesiones abandonadas no aportan evidencia ni cambian el nivel", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 0, { finish: "abandon" });
    await runSession(auth, secA.slug, 0, { finish: "abandon" });
    const s3 = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a = await adaptiveOf(s3);
    assert.equal(a.level, 2);
    assert.equal(a.decision.rule, "insufficient_evidence");
    assert.equal(a.decision.evidence.sessions_count, 0);
  });

  it("paciente existente con sesiones históricas sin nivel: arranca en el nivel inicial", async () => {
    const { patient, auth } = await createPatient(prof);
    for (let i = 0; i < 3; i += 1) {
      const [s] = await db("sessions").insert({ patient_id: patient.id, professional_id: prof.id, status: "completed", started_at: db.fn.now(), completed_at: db.fn.now() }).returning("*");
      await db("session_sections").insert({ session_id: s.id, section_id: secA.id, requested_count: 4 });
      for (const sectionId of [secA.id, null]) {
        await db("session_results").insert({
          session_id: s.id, section_id: sectionId, total_questions: 4, answered_questions: 4, correct_count: 4,
          incorrect_count: 0, unanswered_count: 0, accuracy: 1, completion_rate: 1,
        });
      }
    }
    const id = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a = await adaptiveOf(id);
    assert.equal(a.level, 2);
    assert.equal(a.decision.rule, "initial_level");
  });

  it("actividades independientes: subir en A no afecta el nivel de B", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 4);
    await runSession(auth, secA.slug, 4);
    const a3 = await runSession(auth, secA.slug, 0, { finish: "none" });
    assert.equal((await adaptiveOf(a3)).level, 3);
    const b1 = await runSession(auth, secB.slug, 0, { finish: "none" });
    const b = await adaptiveOf(b1);
    assert.equal(b.level, 2);
    assert.equal(b.decision.rule, "initial_level");
  });

  it("banco insuficiente: 400 y no se crea ninguna sesión", async () => {
    const { patient, auth } = await createPatient(prof);
    const before = await db("sessions").where({ patient_id: patient.id }).count({ c: "*" }).first();
    const res = await createSession(auth, secSmall.slug);
    assert.equal(res.status, 400);
    const afterCount = await db("sessions").where({ patient_id: patient.id }).count({ c: "*" }).first();
    assert.equal(Number(afterCount.c), Number(before.c));
  });

  it("sin preguntas repetidas entre sesiones cercanas cuando el banco alcanza", async () => {
    const { auth } = await createPatient(prof);
    const seen = new Set();
    for (let i = 0; i < 3; i += 1) {
      const id = await runSession(auth, secA.slug, 2);
      for (const q of (await adaptiveOf(id)).questions) {
        assert.equal(seen.has(q.question_id), false, `pregunta ${q.question_id} repetida`);
        seen.add(q.question_id);
      }
    }
  });

  it("fallback documentado: con una sola difícil se completa con media sin duplicar", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secFewHard.slug, 2); // usa la única difícil
    const id = await runSession(auth, secFewHard.slug, 0, { finish: "none" });
    const a = await adaptiveOf(id);
    assert.equal(a.level, 2);
    assert.deepEqual(a.decision.selection.targets, { 1: 1, 2: 2, 3: 1 });
    assert.deepEqual(a.decision.selection.actual_mix, { 1: 1, 2: 3, 3: 0 });
    assert.equal(a.decision.selection.fallback_count, 1);
    assert.equal(new Set(a.questions.map((q) => q.question_id)).size, 4);
  });

  it("filtro de dominios: sólo preguntas del dominio activo, aun con mezcla por dificultad", async () => {
    const { auth } = await createPatient(prof, { active_domain_slugs: JSON.stringify(["atencion"]) });
    const id = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a = await adaptiveOf(id);
    const atencionIds = await db("question_cognitive_domains as qcd")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .where("cd.slug", "atencion").pluck("qcd.question_id");
    assert.equal(a.questions.length, 4);
    assert.ok(a.questions.every((q) => atencionIds.includes(q.question_id)));
  });

  it("concurrencia: dos creaciones simultáneas aplican el cambio una sola vez", async () => {
    const { auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 4);
    await runSession(auth, secA.slug, 4);
    const [r1, r2] = await Promise.all([createSession(auth, secA.slug), createSession(auth, secA.slug)]);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    const decisions = [await adaptiveOf(r1.body.id), await adaptiveOf(r2.body.id)];
    assert.deepEqual(decisions.map((d) => d.level), [3, 3]);
    assert.deepEqual(decisions.map((d) => d.decision.change).sort(), ["hold", "up"]);
  });

  it("completar dos veces (secuencial y simultáneo) no duplica resultados ni evidencia", async () => {
    const { auth } = await createPatient(prof);
    const s1 = await runSession(auth, secA.slug, 4);
    const again = await request(app).post(`/api/sessions/${s1}/complete`).set("Authorization", auth);
    assert.equal(again.status, 409);
    const s2 = await runSession(auth, secA.slug, 4, { finish: "none" });
    const results = await Promise.all([
      request(app).post(`/api/sessions/${s2}/complete`).set("Authorization", auth),
      request(app).post(`/api/sessions/${s2}/complete`).set("Authorization", auth),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const rows = await db("session_results").whereIn("session_id", [s1, s2]).count({ c: "*" }).first();
    assert.equal(Number(rows.c), 4); // sección + global por sesión
    const s3 = await runSession(auth, secA.slug, 0, { finish: "none" });
    const a3 = await adaptiveOf(s3);
    assert.equal(a3.decision.evidence.sessions_count, 2);
    assert.equal(a3.decision.evidence.scored_count, 8);
  });

  it("reinicio del backend: el nivel se deriva sólo de PostgreSQL (pool nuevo, misma decisión)", async () => {
    const { patient, auth } = await createPatient(prof);
    await runSession(auth, secA.slug, 4);
    await runSession(auth, secA.slug, 4);
    // Conexión nueva, sin estado en memoria compartido con el proceso de la API.
    const fresh = knex(knexConfig);
    try {
      const history = await fresh("session_sections as ss")
        .join("sessions as s", "s.id", "ss.session_id")
        .leftJoin("session_results as sr", function j() {
          this.on("sr.session_id", "=", "s.id").andOn("sr.section_id", "=", "ss.section_id");
        })
        .where("s.patient_id", patient.id).where("ss.section_id", secA.id).whereNotNull("ss.adaptive_level")
        .orderBy("s.created_at", "desc").orderBy("s.id", "desc")
        .select("s.id as session_id", "s.status", "ss.adaptive_level", "sr.correct_count", "sr.incorrect_count");
      const expected = computeAdaptiveLevel(history);
      const id = await runSession(auth, secA.slug, 0, { finish: "none" });
      const a = await adaptiveOf(id);
      assert.equal(a.level, expected.level);
      assert.deepEqual(a.decision.evidence, expected.evidence);
    } finally {
      await fresh.destroy();
    }
  });

  it("Ollama apagado: el análisis falla aparte y la adaptación sigue funcionando", async () => {
    const triggered = [];
    setAutoAnalysisTrigger((sessionId) => {
      triggered.push(sessionId);
      Promise.reject(new Error("OLLAMA_OFFLINE")).catch(() => {});
    });
    const { auth } = await createPatient(prof);
    const s1 = await runSession(auth, secA.slug, 4);
    const s2 = await runSession(auth, secA.slug, 4);
    assert.deepEqual(triggered, [s1, s2]);
    const s3 = await runSession(auth, secA.slug, 0, { finish: "none" });
    assert.equal((await adaptiveOf(s3)).level, 3);
    const ctx = await request(app).get(`/api/sessions/${s2}/analysis-context`).set("Authorization", profAuth);
    assert.equal(ctx.status, 200);
    assert.equal(ctx.body.source, "deterministic");
  });

  it("autorización: el profesional ve la decisión, otro profesional no, y el paciente no recibe nivel ni traza", async () => {
    const { patient, auth } = await createPatient(prof);
    const created = await createSession(auth, secA.slug);
    assert.equal(created.status, 201);
    const patientPayload = JSON.stringify(created.body);
    for (const key of ["adaptive_level", "adaptive_decision", "adaptive_version", "difficulty_snapshot", "correct_answer"]) {
      assert.equal(patientPayload.includes(key), false, `POST expone ${key}`);
    }
    const get = await request(app).get(`/api/sessions/${created.body.id}`).set("Authorization", auth);
    assert.equal(get.status, 200);
    const getPayload = JSON.stringify(get.body);
    for (const key of ["adaptive_level", "adaptive_decision", "difficulty_snapshot"]) {
      assert.equal(getPayload.includes(key), false, `GET expone ${key}`);
    }
    const mine = await request(app).get(`/api/patients/${patient.id}/sessions`).set("Authorization", profAuth);
    assert.equal(mine.status, 200);
    assert.equal(mine.body[0].adaptive.level, 2);
    assert.equal(mine.body[0].adaptive.decision.rule, "initial_level");
    const others = await request(app).get(`/api/patients/${patient.id}/sessions`).set("Authorization", otherProfAuth);
    assert.equal(others.status, 404);
    const own = await request(app).get("/api/patient/sessions").set("Authorization", auth);
    assert.equal(own.status, 200);
    assert.equal(JSON.stringify(own.body).includes("adaptive"), false);
  });

  it("manipulación desde el frontend: nivel, dificultad y cantidad enviados por el cliente se ignoran", async () => {
    const { auth } = await createPatient(prof);
    const res = await request(app).post("/api/patient/sessions").set("Authorization", auth).send({
      sections: [{ section_slug: secA.slug, adaptive_level: 3, difficulty: 3, question_count: 10 }],
      adaptive_level: 1,
      level: 3,
      difficulty: 1,
    });
    assert.equal(res.status, 201);
    const a = await adaptiveOf(res.body.id);
    assert.equal(a.level, 2);
    assert.equal(a.decision.rule, "initial_level");
    assert.equal(a.questions.length, 4);
  });

  it("comparación entre niveles distintos: se aclara y no se describe como subida o bajada", async () => {
    const { auth } = await createPatient(prof);
    const s1 = await runSession(auth, secA.slug, 4);
    const s2 = await runSession(auth, secA.slug, 3);
    const s3 = await runSession(auth, secA.slug, 2); // nivel 3
    const same = await request(app).get(`/api/sessions/${s2}/analysis-context`).set("Authorization", profAuth);
    assert.deepEqual(same.body.comparison_metrics.difficulty_level, { current: 2, previous: 2, same: true });
    assert.ok(same.body.observations.some((o) => o.includes("La precisión fue inferior")));

    const diff = await request(app).get(`/api/sessions/${s3}/analysis-context`).set("Authorization", profAuth);
    assert.equal(diff.status, 200);
    assert.deepEqual(diff.body.comparison_metrics.difficulty_level, { current: 3, previous: 2, same: false });
    assert.equal(diff.body.comparison_metrics.accuracy.direction, "bajó"); // métrica aritmética intacta
    const text = diff.body.observations.join(" ");
    assert.ok(text.includes("nivel de dificultad distinto"));
    assert.equal(/precisión fue (superior|inferior|similar)/.test(text), false);
    assert.ok(s1 < s2);
  });

  it("comparación entre una sesión histórica (sin nivel) y una adaptativa: same = null", async () => {
    const { patient, auth } = await createPatient(prof);
    const [old] = await db("sessions").insert({
      patient_id: patient.id, professional_id: prof.id, status: "completed", started_at: db.fn.now(), completed_at: db.fn.now(),
    }).returning("*");
    await db("session_sections").insert({ session_id: old.id, section_id: secA.id, requested_count: 4 });
    for (const sectionId of [secA.id, null]) {
      await db("session_results").insert({
        session_id: old.id, section_id: sectionId, total_questions: 4, answered_questions: 4, correct_count: 1,
        incorrect_count: 3, unanswered_count: 0, accuracy: 0.25, completion_rate: 1,
      });
    }
    const s = await runSession(auth, secA.slug, 3);
    const ctx = await request(app).get(`/api/sessions/${s}/analysis-context`).set("Authorization", profAuth);
    assert.deepEqual(ctx.body.comparison_metrics.difficulty_level, { current: 2, previous: null, same: null });
    assert.ok(ctx.body.observations.some((o) => o.includes("no tiene un nivel de dificultad registrado")));
  });
});

describe("P2 — elegibilidad unificada en POST /api/sessions (profesional)", { concurrency: false }, () => {
  let prof, profAuth, section, patient;

  before(async () => {
    [prof] = await db("users").insert({ role: "professional", name: "Prof P2", email: `prof-p2-${Date.now()}${EMAIL_SUFFIX}` }).returning("*");
    profAuth = authHeaderFor(prof);
    ({ patient } = await createPatient(prof));
    section = await createSection("p2", { 1: 2, 2: 2, 3: 2 }); // todas validation_level=technical, is_validated=false
  });

  after(async () => {
    await cleanup();
    await db.destroy();
  });

  it("acepta preguntas con validation_level técnico (antes rechazaba por contar sólo is_validated)", async () => {
    const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
      patient_id: patient.id, sections: [{ section_id: section.id, question_count: 5 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.sections[0].questions.length, 5);
    // Sesiones creadas por el profesional no usan el mecanismo adaptativo,
    // pero sí guardan la dificultad de cada pregunta.
    assert.equal(res.body.sections[0].adaptive_level, null);
    assert.ok(res.body.sections[0].questions.every((q) => [1, 2, 3].includes(q.difficulty_snapshot)));
  });

  it("sigue rechazando cuando el banco elegible no alcanza", async () => {
    const res = await request(app).post("/api/sessions").set("Authorization", profAuth).send({
      patient_id: patient.id, sections: [{ section_id: section.id, question_count: 7 }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /6 pregunta\(s\) disponible\(s\)/);
  });
});
