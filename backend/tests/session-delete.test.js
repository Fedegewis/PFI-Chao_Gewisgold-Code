// DELETE /api/sessions/:id — eliminación física de sesiones no completadas.
//
// Sólo datos sintéticos propios en la DB local de tests (*_test). Cubre:
// estados permitidos/rechazados, ownership, integridad referencial (cascada
// sin huérfanos), análisis IA pendientes/en curso, concurrencia con
// /complete, e impacto en la rotación de preguntas y en el mecanismo
// adaptativo.

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import {
  resetAutoAnalysisTrigger,
  selectQuestionsForSection,
  setAutoAnalysisTrigger,
} from "../src/routes/sessions.js";
import { renewLease, submitFailed, submitResult } from "../src/services/ai/analysisQueue.js";

const EMAIL_SUFFIX = "@session-delete-test.com";
const SECTION_PREFIX = `sdel_${Date.now()}`;
const SOURCE = "session_delete_fixture";

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
function uniqueEmail(prefix) {
  seq += 1;
  return `${prefix}-${seq}-${Date.now()}${EMAIL_SUFFIX}`;
}

async function createProfessional() {
  const [p] = await db("users")
    .insert({ role: "professional", name: `Prof Del ${seq}`, email: uniqueEmail("prof") })
    .returning("*");
  return { prof: p, auth: authHeaderFor(p) };
}

async function createPatient(prof, extra = {}) {
  const [p] = await db("users").insert({
    role: "patient",
    name: `Paciente Del ${seq}`,
    email: uniqueEmail("pac"),
    professional_id: prof.id,
    max_questions: 4,
    ...extra,
  }).returning("*");
  return { patient: p, auth: authHeaderFor(p) };
}

// Preguntas sintéticas con correct_answer = 0 (0 = correcta, 1 = incorrecta).
async function createSection(suffix, counts) {
  const [section] = await db("sections").insert({
    slug: `${SECTION_PREFIX}_${suffix}`, name: `Del ${suffix}`, description: "fixture", is_active: true, display_order: 960,
  }).returning("*");
  const [memoria] = await db("cognitive_domains").where({ slug: "memoria" }).select("id");
  for (const [difficulty, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) {
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
      await db("question_cognitive_domains").insert({ question_id: q.id, cognitive_domain_id: memoria.id });
    }
  }
  return section;
}

// Sesión creada por el paciente (camino adaptativo).
async function patientSession(auth, slug) {
  const res = await request(app).post("/api/patient/sessions").set("Authorization", auth)
    .send({ sections: [{ section_slug: slug }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.id, questions: res.body.sections[0].questions };
}

// Sesión creada por el profesional (selección no adaptativa).
async function professionalSession(profAuth, patientId, sectionId, count = 4) {
  const res = await request(app).post("/api/sessions").set("Authorization", profAuth)
    .send({ patient_id: patientId, sections: [{ section_id: sectionId, question_count: count }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.id, questions: res.body.sections[0].questions };
}

async function start(auth, id) {
  await request(app).post(`/api/sessions/${id}/start`).set("Authorization", auth).expect(200);
}

async function answerAll(auth, id, questions, correct = questions.length) {
  for (let i = 0; i < questions.length; i += 1) {
    await request(app).post(`/api/sessions/${id}/answers`).set("Authorization", auth).send({
      session_question_id: questions[i].id,
      selected_answer: i < correct ? 0 : 1,
      response_time_ms: 1500,
    }).expect(201);
  }
}

async function complete(auth, id) {
  await request(app).post(`/api/sessions/${id}/complete`).set("Authorization", auth).expect(200);
}

async function abandon(auth, id) {
  await request(app).post(`/api/sessions/${id}/abandon`).set("Authorization", auth).expect(200);
}

function del(auth, id) {
  return request(app).delete(`/api/sessions/${id}`).set("Authorization", auth);
}

// Filas que dependen de la sesión, en todas las tablas hijas.
async function dependentCounts(sessionId) {
  const ssIds = await db("session_sections").where({ session_id: sessionId }).pluck("id");
  const sqIds = ssIds.length ? await db("session_questions").whereIn("session_section_id", ssIds).pluck("id") : [];
  const answers = sqIds.length ? await db("answers").whereIn("session_question_id", sqIds).count({ n: "*" }) : [{ n: 0 }];
  const [{ n: results }] = await db("session_results").where({ session_id: sessionId }).count({ n: "*" });
  const [{ n: analyses }] = await db("session_analyses").where({ session_id: sessionId }).count({ n: "*" });
  const [{ n: sessions }] = await db("sessions").where({ id: sessionId }).count({ n: "*" });
  return {
    sessions: Number(sessions),
    session_sections: ssIds.length,
    session_questions: sqIds.length,
    answers: Number(answers[0].n),
    session_results: Number(results),
    session_analyses: Number(analyses),
  };
}

const EMPTY = { sessions: 0, session_sections: 0, session_questions: 0, answers: 0, session_results: 0, session_analyses: 0 };

// Huérfanos globales: filas hijas cuyo padre ya no existe.
async function orphanCounts() {
  const q = async (sql) => Number((await db.raw(sql)).rows[0].n);
  return {
    session_sections: await q("SELECT count(*) AS n FROM session_sections ss LEFT JOIN sessions s ON s.id = ss.session_id WHERE s.id IS NULL"),
    session_questions: await q("SELECT count(*) AS n FROM session_questions sq LEFT JOIN session_sections ss ON ss.id = sq.session_section_id WHERE ss.id IS NULL"),
    answers: await q("SELECT count(*) AS n FROM answers a LEFT JOIN session_questions sq ON sq.id = a.session_question_id WHERE sq.id IS NULL"),
    session_results: await q("SELECT count(*) AS n FROM session_results r LEFT JOIN sessions s ON s.id = r.session_id WHERE s.id IS NULL"),
    session_analyses: await q("SELECT count(*) AS n FROM session_analyses a LEFT JOIN sessions s ON s.id = a.session_id WHERE s.id IS NULL"),
  };
}

// Espera hasta que haya al menos un lock no otorgado (una request bloqueada
// en el FOR UPDATE que mantiene abierta la transacción del test).
async function waitForBlockedLock(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.raw("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted");
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("La request no llegó a bloquearse en el lock de la sesión");
}

describe("DELETE /api/sessions/:id", { concurrency: false }, () => {
  let prof, profAuth, otherProfAuth, section, bigSection, rotSection;

  before(async () => {
    await cleanup();
    ({ prof, auth: profAuth } = await createProfessional());
    ({ auth: otherProfAuth } = await createProfessional());
    section = await createSection("main", { 1: 6, 2: 6, 3: 6 });
    bigSection = await createSection("big", { 1: 12, 2: 12, 3: 12 });
    rotSection = await createSection("rot", { 2: 8 });
    // /complete dispara el análisis IA en background: lo neutralizamos.
    setAutoAnalysisTrigger(() => {});
  });

  afterEach(() => setAutoAnalysisTrigger(() => {}));

  after(async () => {
    resetAutoAnalysisTrigger();
    await cleanup();
    await db.destroy();
  });

  describe("estados permitidos", () => {
    it("elimina una sesión 'created' (Iniciada) con todo lo asociado", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      assert.ok((await dependentCounts(s.id)).session_questions > 0);

      const res = await del(profAuth, s.id);
      assert.equal(res.status, 204);
      assert.deepEqual(await dependentCounts(s.id), EMPTY);
    });

    it("elimina una sesión 'in_progress' con respuestas registradas", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      await start(auth, s.id);
      await answerAll(auth, s.id, s.questions.slice(0, 2));
      assert.equal((await dependentCounts(s.id)).answers, 2);

      const res = await del(profAuth, s.id);
      assert.equal(res.status, 204);
      assert.deepEqual(await dependentCounts(s.id), EMPTY);
    });

    it("elimina una sesión 'abandoned'", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      await start(auth, s.id);
      await answerAll(auth, s.id, s.questions.slice(0, 1));
      await abandon(auth, s.id);

      const res = await del(profAuth, s.id);
      assert.equal(res.status, 204);
      assert.deepEqual(await dependentCounts(s.id), EMPTY);
    });

    it("una segunda eliminación de la misma sesión responde 404", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      assert.equal((await del(profAuth, s.id)).status, 204);
      assert.equal((await del(profAuth, s.id)).status, 404);
    });
  });

  describe("rechazos", () => {
    it("rechaza eliminar una sesión completada (409) y no toca nada", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      await start(auth, s.id);
      await answerAll(auth, s.id, s.questions);
      await complete(auth, s.id);
      const before = await dependentCounts(s.id);

      const res = await del(profAuth, s.id);
      assert.equal(res.status, 409);
      assert.equal(res.body.status, "completed");
      assert.deepEqual(await dependentCounts(s.id), before);
    });

    it("profesional que no gestiona al paciente: 404 y la sesión sigue intacta", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      const before = await dependentCounts(s.id);

      const res = await del(otherProfAuth, s.id);
      assert.equal(res.status, 404);
      assert.deepEqual(await dependentCounts(s.id), before);
    });

    it("el paciente no puede eliminar ni su propia sesión (403)", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      const res = await del(auth, s.id);
      assert.equal(res.status, 403);
      assert.equal((await dependentCounts(s.id)).sessions, 1);
    });

    it("sin token: 401", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      const res = await request(app).delete(`/api/sessions/${s.id}`);
      assert.equal(res.status, 401);
      assert.equal((await dependentCounts(s.id)).sessions, 1);
    });

    it("sesión inexistente o id inválido: 404", async () => {
      const [{ max }] = await db("sessions").max({ max: "id" });
      assert.equal((await del(profAuth, Number(max || 0) + 100000)).status, 404);
      assert.equal((await del(profAuth, "abc")).status, 404);
      assert.equal((await del(profAuth, 0)).status, 404);
    });

    it("ignora professional_id del cliente: la autorización sale del JWT", async () => {
      const { prof: ownerProf } = await createProfessional();
      const { auth } = await createPatient(ownerProf);
      const s = await patientSession(auth, section.slug);
      const res = await request(app).delete(`/api/sessions/${s.id}`)
        .set("Authorization", otherProfAuth)
        .send({ professional_id: ownerProf.id });
      assert.equal(res.status, 404);
      assert.equal((await dependentCounts(s.id)).sessions, 1);
    });
  });

  describe("integridad referencial", () => {
    it("no deja huérfanos y no toca sesiones de otros pacientes ni las completadas", async () => {
      const { auth: a1 } = await createPatient(prof);
      const { auth: a2 } = await createPatient(prof);
      const done = await patientSession(a1, section.slug);
      await start(a1, done.id);
      await answerAll(a1, done.id, done.questions);
      await complete(a1, done.id);
      const target = await patientSession(a1, section.slug);
      await start(a1, target.id);
      await answerAll(a1, target.id, target.questions.slice(0, 2));
      const other = await patientSession(a2, section.slug);
      await start(a2, other.id);
      await answerAll(a2, other.id, other.questions.slice(0, 1));

      const doneBefore = await dependentCounts(done.id);
      const otherBefore = await dependentCounts(other.id);

      assert.equal((await del(profAuth, target.id)).status, 204);

      assert.deepEqual(await dependentCounts(target.id), EMPTY);
      assert.deepEqual(await dependentCounts(done.id), doneBefore);
      assert.deepEqual(await dependentCounts(other.id), otherBefore);
      assert.deepEqual(await orphanCounts(), {
        session_sections: 0, session_questions: 0, answers: 0, session_results: 0, session_analyses: 0,
      });
      // Las preguntas del banco no se eliminan (FK RESTRICT desde session_questions).
      const remaining = await db("questions").whereIn("id", target.questions.map((q) => q.question_id)).count({ n: "*" });
      assert.equal(Number(remaining[0].n), target.questions.length);
    });

    it("el historial del profesional deja de listar la sesión eliminada", async () => {
      const { patient, auth } = await createPatient(prof);
      const keep = await patientSession(auth, section.slug);
      await start(auth, keep.id);
      await answerAll(auth, keep.id, keep.questions);
      await complete(auth, keep.id);
      const drop = await patientSession(auth, section.slug);
      await start(auth, drop.id);
      await abandon(auth, drop.id);

      const before = await request(app).get(`/api/patients/${patient.id}/sessions`).set("Authorization", profAuth);
      assert.deepEqual(before.body.map((s) => s.id).sort(), [keep.id, drop.id].sort());

      assert.equal((await del(profAuth, drop.id)).status, 204);

      const afterRes = await request(app).get(`/api/patients/${patient.id}/sessions`).set("Authorization", profAuth);
      assert.deepEqual(afterRes.body.map((s) => s.id), [keep.id]);
      assert.equal(afterRes.body[0].status, "completed");
    });
  });

  describe("análisis IA", () => {
    async function insertAnalysis(sessionId, row) {
      const [r] = await db("session_analyses").insert({
        session_id: sessionId, model: "fixture-model", schema_version: "3", prompt_version: "fixture", ...row,
      }).returning("*");
      return r;
    }

    it("elimina análisis pendientes/fallidos y el worker no puede escribir resultados (CLAIM_LOST)", async () => {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      await start(auth, s.id);
      await abandon(auth, s.id);
      // Filas sintéticas: un claim 'generating' con lease vivo (job en curso)
      // y un intento 'failed' previo.
      const claim = await insertAnalysis(s.id, {
        status: "generating",
        claim_token: "tok-session-delete",
        lease_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        attempt_count: 1,
      });
      await insertAnalysis(s.id, { status: "failed", error_code: "OLLAMA_TIMEOUT", error_message: "fixture" });

      assert.equal((await del(profAuth, s.id)).status, 204);
      assert.deepEqual(await dependentCounts(s.id), EMPTY);

      const params = { claimId: claim.id, claimToken: "tok-session-delete" };
      await assert.rejects(
        submitResult({ ...params, rawText: '{"schema_version":"3","summary":"x"}', latencyMs: 10 }),
        (err) => err.code === "CLAIM_LOST"
      );
      await assert.rejects(
        submitFailed({ ...params, errorCode: "OLLAMA_TIMEOUT", errorMessage: "x" }),
        (err) => err.code === "CLAIM_LOST"
      );
      await assert.rejects(renewLease(params), (err) => err.code === "CLAIM_LOST");
      // Ninguna escritura del worker resucitó filas.
      assert.equal((await dependentCounts(s.id)).session_analyses, 0);
    });

    it("el endpoint del worker responde 409 CLAIM_LOST tras la eliminación", async (t) => {
      const previousToken = process.env.WORKER_TOKEN;
      const token = "session-delete-test-worker-token-0123456789";
      process.env.WORKER_TOKEN = token;
      t.after(() => {
        if (previousToken === undefined) delete process.env.WORKER_TOKEN;
        else process.env.WORKER_TOKEN = previousToken;
      });
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      const claim = await insertAnalysis(s.id, {
        status: "generating",
        claim_token: "tok-endpoint",
        lease_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        attempt_count: 1,
      });
      assert.equal((await del(profAuth, s.id)).status, 204);

      const res = await request(app).post("/api/worker/analysis/result")
        .set("Authorization", `Bearer ${token}`)
        .send({ claim_id: claim.id, claim_token: "tok-endpoint", raw_text: '{"schema_version":"3","summary":"x"}', latency_ms: 5 });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.code, "CLAIM_LOST");
    });
  });

  describe("el paciente con la sesión abierta tras la eliminación", () => {
    it("start/answers/complete/abandon responden 404 sin errores 500", async () => {
      const { auth } = await createPatient(prof);
      const created = await patientSession(auth, section.slug);
      assert.equal((await del(profAuth, created.id)).status, 204);
      assert.equal((await request(app).post(`/api/sessions/${created.id}/start`).set("Authorization", auth)).status, 404);

      const running = await patientSession(auth, section.slug);
      await start(auth, running.id);
      assert.equal((await del(profAuth, running.id)).status, 204);
      const ans = await request(app).post(`/api/sessions/${running.id}/answers`).set("Authorization", auth)
        .send({ session_question_id: running.questions[0].id, selected_answer: 0, response_time_ms: 1000 });
      assert.equal(ans.status, 404);
      assert.equal((await request(app).post(`/api/sessions/${running.id}/complete`).set("Authorization", auth)).status, 404);
      assert.equal((await request(app).post(`/api/sessions/${running.id}/abandon`).set("Authorization", auth)).status, 404);
    });
  });

  describe("concurrencia con /complete", () => {
    async function readySession() {
      const { auth } = await createPatient(prof);
      const s = await patientSession(auth, section.slug);
      await start(auth, s.id);
      await answerAll(auth, s.id, s.questions);
      return { auth, s };
    }

    it("si complete gana el lock, la eliminación ve 'completed' y responde 409", async () => {
      const { s } = await readySession();
      const trx = await db.transaction();
      try {
        // Simula un /complete en curso: lock de la fila + cambio de estado.
        await trx("sessions").where({ id: s.id }).forUpdate().first();
        const pending = del(profAuth, s.id).then((r) => r);
        await waitForBlockedLock();
        await trx("sessions").where({ id: s.id }).update({ status: "completed", completed_at: trx.fn.now() });
        await trx.commit();
        const res = await pending;
        assert.equal(res.status, 409);
        assert.equal(res.body.status, "completed");
        assert.equal((await dependentCounts(s.id)).sessions, 1);
      } finally {
        if (!trx.isCompleted()) await trx.rollback();
      }
    });

    it("si la eliminación gana el lock, complete responde 404 y no inserta resultados", async () => {
      const { auth, s } = await readySession();
      const trx = await db.transaction();
      try {
        await trx("sessions").where({ id: s.id }).forUpdate().first();
        const pending = request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", auth).then((r) => r);
        await waitForBlockedLock();
        await trx("sessions").where({ id: s.id }).del();
        await trx.commit();
        const res = await pending;
        assert.equal(res.status, 404, JSON.stringify(res.body));
        assert.deepEqual(await dependentCounts(s.id), EMPTY);
      } finally {
        if (!trx.isCompleted()) await trx.rollback();
      }
    });

    it("carrera real: exactamente uno de los dos gana y el estado final es consistente", async () => {
      for (let i = 0; i < 5; i += 1) {
        const { auth, s } = await readySession();
        const [delRes, completeRes] = await Promise.all([
          del(profAuth, s.id),
          request(app).post(`/api/sessions/${s.id}/complete`).set("Authorization", auth),
        ]);
        const counts = await dependentCounts(s.id);
        if (delRes.status === 204) {
          assert.equal(completeRes.status, 404, JSON.stringify(completeRes.body));
          assert.deepEqual(counts, EMPTY);
        } else {
          assert.equal(delRes.status, 409);
          assert.equal(completeRes.status, 200);
          assert.equal(counts.sessions, 1);
          assert.equal(counts.session_results, 2); // sección + global
        }
      }
    });
  });

  describe("impacto en la rotación de preguntas", () => {
    it("las preguntas de la sesión eliminada dejan de contar como recientes", async () => {
      // 8 preguntas, 4 por sesión. A (abandonada) usa SA; C (completada,
      // creada después) usa el complemento SC porque SA es reciente.
      const { patient, auth } = await createPatient(prof);
      const a = await professionalSession(profAuth, patient.id, rotSection.id);
      await start(auth, a.id);
      await abandon(auth, a.id);
      const SA = new Set(a.questions.map((q) => q.question_id));

      const c = await professionalSession(profAuth, patient.id, rotSection.id);
      const SC = new Set(c.questions.map((q) => q.question_id));
      assert.equal([...SC].filter((id) => SA.has(id)).length, 0, "C evita las preguntas recientes de A");
      await start(auth, c.id);
      await answerAll(auth, c.id, c.questions);
      await complete(auth, c.id);

      // Con A y C en la ventana, todas son recientes (no hay preferidas).
      const beforeDel = await selectQuestionsForSection(db, patient.id, rotSection.id, 4);
      assert.equal(beforeDel.error, false);

      assert.equal((await del(profAuth, a.id)).status, 204);

      // Sin A en la ventana, las preferidas son exactamente SA.
      const afterDel = await selectQuestionsForSection(db, patient.id, rotSection.id, 4);
      assert.deepEqual(new Set(afterDel.questions.map((q) => q.id)), SA);
      // La completada C sigue intacta.
      assert.equal((await dependentCounts(c.id)).session_results, 2);
    });
  });

  describe("impacto en el mecanismo adaptativo", () => {
    it("eliminar una sesión no completada no altera el nivel ni la evidencia de la siguiente", async () => {
      const { auth } = await createPatient(prof);
      // Dos sesiones completadas al 100 % en nivel 2 ⇒ la siguiente sube a 3.
      const completedIds = [];
      for (let i = 0; i < 2; i += 1) {
        const s = await patientSession(auth, bigSection.slug);
        await start(auth, s.id);
        await answerAll(auth, s.id, s.questions);
        await complete(auth, s.id);
        completedIds.push(s.id);
      }
      const x = await patientSession(auth, bigSection.slug);
      const xss = await db("session_sections").where({ session_id: x.id }).first();
      await start(auth, x.id);
      await abandon(auth, x.id);

      assert.equal((await del(profAuth, x.id)).status, 204);

      const y = await patientSession(auth, bigSection.slug);
      const yss = await db("session_sections").where({ session_id: y.id }).first();
      assert.equal(yss.adaptive_level, xss.adaptive_level);
      assert.equal(yss.adaptive_decision.change, xss.adaptive_decision.change);
      assert.equal(yss.adaptive_decision.rule, xss.adaptive_decision.rule);
      assert.deepEqual(yss.adaptive_decision.evidence, xss.adaptive_decision.evidence);
      assert.deepEqual(
        [...yss.adaptive_decision.evidence.session_ids].sort(),
        [...completedIds].sort()
      );
      // Las sesiones completadas que sostienen la evidencia siguen intactas.
      for (const id of completedIds) {
        assert.equal((await dependentCounts(id)).session_results, 2);
      }
    });
  });
});
