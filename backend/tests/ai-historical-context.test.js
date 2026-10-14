// Tests de integración del selector de historial longitudinal.
//
// Cubren la política de selección documentada en historicalContext.js:
//   - solo sesiones del MISMO paciente
//   - solo status='completed'
//   - solo anteriores cronológicamente a beforeCreatedAt
//   - límite por defecto 3
//   - orden desc por created_at
//   - metadata trabajada (section_slugs + cognitive_domain_slugs) por sesión

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db/connection.js";
import { loadPreviousSessions, filterComparableSessions, HISTORICAL_SESSION_LIMIT } from "../src/services/ai/historicalContext.js";

const EMAIL_SUFFIX = "@historical-context-test.com";

async function cleanTestData() {
  const userIds = await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).pluck("id");
  if (userIds.length === 0) return;
  const sessionIds = await db("sessions").whereIn("patient_id", userIds).pluck("id");
  if (sessionIds.length > 0) {
    const sectionIds = await db("session_sections").whereIn("session_id", sessionIds).pluck("id");
    if (sectionIds.length > 0) {
      await db("session_questions").whereIn("session_section_id", sectionIds).del();
    }
    await db("session_sections").whereIn("session_id", sessionIds).del();
    await db("session_results").whereIn("session_id", sessionIds).del();
    await db("sessions").whereIn("id", sessionIds).del();
  }
  await db("users").whereIn("id", userIds).del();
}

// Helpers de fixture: insertan directamente usuario, sesión, section y resultado
// con status/mood deseados. No pasan por los endpoints HTTP porque este test
// cubre la query, no el ciclo de vida.
async function createPatient(suffix) {
  const stamp = `${Date.now()}-${suffix}`;
  const [prof] = await db("users")
    .insert({ role: "professional", name: `Prof ${suffix}`, email: `prof-${stamp}${EMAIL_SUFFIX}` })
    .returning("*");
  const [patient] = await db("users")
    .insert({ role: "patient", name: `Pat ${suffix}`, email: `pat-${stamp}${EMAIL_SUFFIX}`, professional_id: prof.id })
    .returning("*");
  return { prof, patient };
}

async function createCompletedSession(patient, { createdAt, sectionSlug = "memoria_de_trabajo", metricsOverride = {} }) {
  const [sec] = await db("sections").where({ slug: sectionSlug }).select("id", "slug");
  const [session] = await db("sessions")
    .insert({
      patient_id: patient.id,
      professional_id: patient.professional_id,
      status: "completed",
      created_at: createdAt,
      started_at: createdAt,
      completed_at: createdAt,
    })
    .returning("*");
  const [ss] = await db("session_sections")
    .insert({ session_id: session.id, section_id: sec.id, requested_count: 1, display_order: 1 })
    .returning("*");
  // Insertar una pregunta de la sección para que luego el join con cognitive_domains funcione.
  const [q] = await db("questions").where({ section_id: sec.id, is_active: true }).limit(1).select("id");
  if (q) {
    await db("session_questions").insert({
      session_section_id: ss.id,
      question_id: q.id,
      display_order: 1,
      prompt_snapshot: "snap",
      options_snapshot: JSON.stringify(["a", "b", "c", "d"]),
      correct_answer_snapshot: 0,
      response_type: "multiple_choice",
    });
  }
  const metrics = {
    total_questions: 1, answered_questions: 1, correct_count: 1, incorrect_count: 0, unanswered_count: 0,
    accuracy: 1, completion_rate: 1,
    mean_latency_ms: 1000, min_latency_ms: 1000, max_latency_ms: 1000, latency_std_ms: 0,
    ...metricsOverride,
  };
  // Global y por sección.
  await db("session_results").insert({ session_id: session.id, section_id: null, ...metrics });
  await db("session_results").insert({ session_id: session.id, section_id: sec.id, ...metrics });
  return session;
}

describe("historicalContext — selección de sesiones previas", () => {
  before(cleanTestData);
  // Cerrar el pool Knex explícitamente en teardown. Sin esto, las conexiones
  // ociosas del pool mantienen vivo el event loop y el runner (--test-concurrency=1)
  // nunca sale al terminar el archivo. Patrón reutilizado del resto de la suite
  // (ver patient-sessions, analysis-endpoint, etc.).
  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  it("sesión sin historial devuelve []", async () => {
    const { patient } = await createPatient("none");
    const out = await loadPreviousSessions(db, {
      patientId: patient.id,
      beforeCreatedAt: new Date(),
    });
    assert.deepEqual(out, []);
  });

  it("devuelve 1 sesión previa comparable", async () => {
    const { patient } = await createPatient("one");
    const earlier = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await createCompletedSession(patient, { createdAt: earlier, metricsOverride: { accuracy: 0.6 } });
    const out = await loadPreviousSessions(db, {
      patientId: patient.id,
      beforeCreatedAt: new Date(),
    });
    assert.equal(out.length, 1);
    assert.equal(Number(out[0].global_metrics.accuracy), 0.6);
    assert.deepEqual(out[0].section_slugs, ["memoria_de_trabajo"]);
    assert.equal(Array.isArray(out[0].cognitive_domain_slugs), true);
  });

  it("devuelve hasta 3 cuando hay 5 previas", async () => {
    const { patient } = await createPatient("many");
    for (let i = 1; i <= 5; i++) {
      const ago = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      await createCompletedSession(patient, { createdAt: ago });
    }
    const out = await loadPreviousSessions(db, {
      patientId: patient.id,
      beforeCreatedAt: new Date(),
    });
    assert.equal(out.length, 3);
    assert.equal(out.length, HISTORICAL_SESSION_LIMIT);
    // Debe estar en orden descendente por fecha.
    for (let i = 1; i < out.length; i++) {
      assert.ok(new Date(out[i - 1].created_at) >= new Date(out[i].created_at));
    }
  });

  it("excluye sesiones de OTRO paciente", async () => {
    const { patient: p1 } = await createPatient("own");
    const { patient: p2 } = await createPatient("other");
    const earlier = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await createCompletedSession(p1, { createdAt: earlier });
    await createCompletedSession(p2, { createdAt: earlier });
    const out = await loadPreviousSessions(db, {
      patientId: p1.id,
      beforeCreatedAt: new Date(),
    });
    assert.equal(out.length, 1);
  });

  it("excluye sesiones posteriores a beforeCreatedAt", async () => {
    const { patient } = await createPatient("future");
    const nowRef = new Date();
    // Sesión posterior → NO debería estar.
    const laterDate = new Date(nowRef.getTime() + 60 * 1000);
    await createCompletedSession(patient, { createdAt: laterDate });
    // Sesión anterior → sí.
    const earlier = new Date(nowRef.getTime() - 24 * 60 * 60 * 1000);
    await createCompletedSession(patient, { createdAt: earlier });
    const out = await loadPreviousSessions(db, {
      patientId: patient.id,
      beforeCreatedAt: nowRef,
    });
    assert.equal(out.length, 1);
  });

  it("excluye sesiones abandonadas o en progreso", async () => {
    const { patient } = await createPatient("notcomplete");
    const earlier = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [abandoned] = await db("sessions")
      .insert({
        patient_id: patient.id,
        professional_id: patient.professional_id,
        status: "abandoned",
        created_at: earlier,
      })
      .returning("*");
    assert.equal(abandoned.status, "abandoned");
    const out = await loadPreviousSessions(db, {
      patientId: patient.id,
      beforeCreatedAt: new Date(),
    });
    assert.deepEqual(out, []);
  });

  it("respeta un límite distinto cuando se pasa explícitamente", async () => {
    const { patient } = await createPatient("limitarg");
    for (let i = 1; i <= 4; i++) {
      await createCompletedSession(patient, { createdAt: new Date(Date.now() - i * 86400000) });
    }
    const out = await loadPreviousSessions(db, {
      patientId: patient.id,
      beforeCreatedAt: new Date(),
      limit: 2,
    });
    assert.equal(out.length, 2);
  });
});

// Puros (sin DB) — se incluyen en el mismo file para no abrir otro pool.
describe("historicalContext — filterComparableSessions (puro)", () => {
  it("devuelve [] si no hay previous_sessions", () => {
    const out = filterComparableSessions([], { section_slugs: ["a"], cognitive_domain_slugs: ["memoria"] });
    assert.deepEqual(out, []);
  });

  it("conserva previa que comparte MISMA section_slug", () => {
    const prev = [{ section_slugs: ["memoria_de_trabajo"], cognitive_domain_slugs: ["atencion"] }];
    const out = filterComparableSessions(prev, {
      section_slugs: ["memoria_de_trabajo"],
      cognitive_domain_slugs: ["funciones_ejecutivas"],
    });
    assert.equal(out.length, 1);
  });

  // v2.4 (BUG-11): comparabilidad ESTRICTA por section_slug. Un dominio
  // cognitivo compartido NO es suficiente para considerar comparable: tras
  // la expansión N:M del banco, casi cualquier sesión matcheaba por dominio
  // tangencial y producía comparaciones sin sentido.
  it("DESCARTA previa que sólo comparte dominio (secciones distintas)", () => {
    const prev = [{ section_slugs: ["seccion_x"], cognitive_domain_slugs: ["memoria"] }];
    const out = filterComparableSessions(prev, {
      section_slugs: ["seccion_y"],
      cognitive_domain_slugs: ["memoria"],
    });
    assert.deepEqual(out, []);
  });

  it("descarta previa que no comparte section (dominio irrelevante)", () => {
    const prev = [{ section_slugs: ["seccion_x"], cognitive_domain_slugs: ["memoria"] }];
    const out = filterComparableSessions(prev, {
      section_slugs: ["seccion_y"],
      cognitive_domain_slugs: ["orientacion"],
    });
    assert.deepEqual(out, []);
  });

  it("mezcla: conserva sólo las que comparten section_slug, preserva orden", () => {
    const prev = [
      { section_slugs: ["a"], cognitive_domain_slugs: ["memoria"] },        // ni ni (section distinta)
      { section_slugs: ["z"], cognitive_domain_slugs: ["desconocido"] },    // ni ni
      { section_slugs: ["seccion_actual"], cognitive_domain_slugs: ["x"] },// comparable por section
      { section_slugs: ["z"], cognitive_domain_slugs: ["z"] },              // ni ni
    ];
    const out = filterComparableSessions(prev, {
      section_slugs: ["seccion_actual"],
      cognitive_domain_slugs: ["memoria"],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].section_slugs[0], "seccion_actual");
  });

  it("si currentContext sin section_slugs, no considera nada comparable", () => {
    const prev = [{ section_slugs: ["a"], cognitive_domain_slugs: ["memoria"] }];
    assert.deepEqual(filterComparableSessions(prev, { section_slugs: [], cognitive_domain_slugs: [] }), []);
  });
});
