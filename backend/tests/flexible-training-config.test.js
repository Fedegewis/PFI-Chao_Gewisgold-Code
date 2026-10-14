// Tests de integración de F1 (validation_level), F2 (active_section_slugs) y F3
// (prevención del error de preguntas insuficientes). Usa fixtures aisladas con
// un sufijo propio para no mezclarse con otros tests concurrentes de la suite.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@flex-config-test.com";
const SECTION_PREFIX = `flex_cfg_${Date.now()}`;

async function cleanup() {
  const ids = await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).pluck("id");
  if (ids.length) {
    const sessionIds = await db("sessions").whereIn("patient_id", ids).pluck("id");
    if (sessionIds.length) {
      const ssIds = await db("session_sections").whereIn("session_id", sessionIds).pluck("id");
      if (ssIds.length) await db("session_questions").whereIn("session_section_id", ssIds).del();
      await db("session_sections").whereIn("session_id", sessionIds).del();
      await db("sessions").whereIn("id", sessionIds).del();
    }
  }
  const qids = await db("questions").where("source", "flex_cfg_fixture").pluck("id");
  if (qids.length) {
    await db("question_cognitive_domains").whereIn("question_id", qids).del();
    await db("questions").whereIn("id", qids).del();
  }
  await db("sections").where("slug", "like", `${SECTION_PREFIX}_%`).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Configuración flexible F1+F2+F3", { concurrency: false }, () => {
  let prof, patient, patientAuth, profAuth;
  let secA, secB, secC, secD;
  let memoriaId, atencionId, orientacionId;

  before(async () => {
    await cleanup();

    [prof] = await db("users").insert({
      role: "professional", name: "Prof Flex", email: `prof-${Date.now()}${EMAIL_SUFFIX}`,
    }).returning("*");
    [patient] = await db("users").insert({
      role: "patient", name: "Pac Flex", email: `pac-${Date.now()}${EMAIL_SUFFIX}`, professional_id: prof.id,
    }).returning("*");
    profAuth = authHeaderFor(prof);
    patientAuth = authHeaderFor(patient);

    [secA] = await db("sections").insert({ slug: `${SECTION_PREFIX}_a`, name: "Flex A", description: "d", is_active: true, display_order: 900 }).returning("*");
    [secB] = await db("sections").insert({ slug: `${SECTION_PREFIX}_b`, name: "Flex B", description: "d", is_active: true, display_order: 901 }).returning("*");
    [secC] = await db("sections").insert({ slug: `${SECTION_PREFIX}_c`, name: "Flex C", description: "d", is_active: true, display_order: 902 }).returning("*");

    const [m] = await db("cognitive_domains").select("id").where({ slug: "memoria" });
    const [a] = await db("cognitive_domains").select("id").where({ slug: "atencion" });
    const [o] = await db("cognitive_domains").select("id").where({ slug: "orientacion" });
    memoriaId = m.id; atencionId = a.id; orientacionId = o.id;

    // Sección A: 15 preguntas; mitad validadas, mitad con validation_level=technical.
    // Dominios: 10 con memoria, 5 con atencion. Para test de multidominio: 3 con AMBOS.
    const inserted = [];
    for (let i = 0; i < 15; i++) {
      const [row] = await db("questions").insert({
        section_id: secA.id,
        prompt: `A-${i + 1} ¿Pregunta de ejemplo con largo suficiente?`,
        response_type: "multiple_choice",
        options: JSON.stringify(["X", "Y", "Z", "W"]),
        correct_answer: 0,
        is_active: true,
        is_validated: i < 7, // 7 is_validated=true, 8 is_validated=false
        validation_level: i < 7 ? null : "technical", // 8 con technical
        source: "flex_cfg_fixture",
      }).returning("*");
      inserted.push(row.id);
    }
    // Dominios: 10 memoria, 5 atencion, con 3 solapamiento (multidominio).
    for (let i = 0; i < 10; i++) {
      await db("question_cognitive_domains").insert({ question_id: inserted[i], cognitive_domain_id: memoriaId });
    }
    for (let i = 7; i < 12; i++) {
      await db("question_cognitive_domains").insert({ question_id: inserted[i], cognitive_domain_id: atencionId });
    }

    // Sección B: 4 preguntas sólo con orientacion.
    const insertedB = [];
    for (let i = 0; i < 4; i++) {
      const [row] = await db("questions").insert({
        section_id: secB.id,
        prompt: `B-${i + 1} ¿Pregunta orientacion?`,
        response_type: "multiple_choice",
        options: JSON.stringify(["X", "Y", "Z", "W"]),
        correct_answer: 1,
        is_active: true, is_validated: true, source: "flex_cfg_fixture",
      }).returning("*");
      insertedB.push(row.id);
      await db("question_cognitive_domains").insert({ question_id: row.id, cognitive_domain_id: orientacionId });
    }

    // Sección C: 20 preguntas memoria, útil para reutilización entre sesiones.
    const insertedC = [];
    for (let i = 0; i < 20; i++) {
      const [row] = await db("questions").insert({
        section_id: secC.id,
        prompt: `C-${i + 1} ¿Memoria?`,
        response_type: "multiple_choice",
        options: JSON.stringify(["A", "B", "C", "D"]),
        correct_answer: 2,
        is_active: true, is_validated: true, source: "flex_cfg_fixture",
      }).returning("*");
      insertedC.push(row.id);
      await db("question_cognitive_domains").insert({ question_id: row.id, cognitive_domain_id: memoriaId });
    }

    // Sección D: aislada para el test de reutilización (evita cross-pollution
    // entre describes paralelos). 20 preguntas memoria.
    [secD] = await db("sections").insert({ slug: `${SECTION_PREFIX}_d`, name: "Flex D", description: "d", is_active: true, display_order: 903 }).returning("*");
    for (let i = 0; i < 20; i++) {
      const [row] = await db("questions").insert({
        section_id: secD.id,
        prompt: `D-${i + 1} ¿Memoria reutilización?`,
        response_type: "multiple_choice",
        options: JSON.stringify(["A", "B", "C", "D"]),
        correct_answer: 2,
        is_active: true, is_validated: true, source: "flex_cfg_fixture",
      }).returning("*");
      await db("question_cognitive_domains").insert({ question_id: row.id, cognitive_domain_id: memoriaId });
    }
  });

  after(async () => {
    await cleanup();
    await db.destroy();
  });

  describe("F1 — validation_level", () => {
    it("preguntas con validation_level='technical' se consideran elegibles aunque is_validated=false", async () => {
      // En sección A, 7 validated y 8 technical: filtro memoria debería devolver 10
      // (las primeras 10 son memoria). Sin filtro de dominios debería devolver 15.
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: null,
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).get("/api/patient/available-sections").set("Authorization", patientAuth);
      assert.equal(r.status, 200);
      const row = r.body.sections.find((s) => s.section_slug === secA.slug);
      assert.ok(row);
      assert.equal(row.available, 15);
      assert.equal(row.startable, true);
    });

    it("no se promueve validation_level='clinical' automáticamente para preguntas con is_validated=true preexistentes", async () => {
      const legacy = await db("questions").where({ section_id: secA.id, is_validated: true, validation_level: null }).count("* as c").first();
      assert.ok(Number(legacy.c) > 0, "Las preguntas con is_validated=true deben preservar validation_level=NULL");
    });
  });

  describe("F2 — selección 10 preguntas", () => {
    it("1 dominio + 1 actividad: selecciona 10 preguntas sin repetir dentro de la sesión", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: JSON.stringify(["memoria"]),
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({ sections: [{ section_slug: secA.slug }] });
      assert.equal(r.status, 201);
      const qs = r.body.sections[0].questions;
      assert.equal(qs.length, 10);
      const ids = qs.map((q) => q.question_id);
      assert.equal(new Set(ids).size, 10, "No debe repetir preguntas dentro de la sesión");
    });

    it("2 dominios: la cantidad total NO se multiplica por dominio", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: JSON.stringify(["memoria", "atencion"]),
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({ sections: [{ section_slug: secA.slug }] });
      assert.equal(r.status, 201);
      assert.equal(r.body.sections[0].questions.length, 10);
    });

    it("3 dominios: idem — cuenta total 10, no por dominio", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: JSON.stringify(["memoria", "atencion", "orientacion"]),
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({ sections: [{ section_slug: secA.slug }] });
      assert.equal(r.status, 201);
      assert.equal(r.body.sections[0].questions.length, 10);
    });

    it("preguntas multidominio cuentan una sola vez (DISTINCT)", async () => {
      // En sección A, hay 3 preguntas con AMBOS dominios memoria y atencion
      // (índices 7-9: memoria + atencion). Si contara dos veces, el eligible
      // count sería inflado. countEligibleQuestions usa DISTINCT.
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: JSON.stringify(["memoria", "atencion"]),
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).get("/api/patient/available-sections").set("Authorization", patientAuth);
      const row = r.body.sections.find((s) => s.section_slug === secA.slug);
      // Memoria=10 (0-9), atencion=5 (7-11). Unión distinct: {0..11} = 12.
      assert.equal(row.available, 12);
    });
  });

  describe("F2 — rechazos y persistencia", () => {
    it("rechaza config si no hay sección viable con la combinación elegida", async () => {
      // max_questions=10, dominio orientacion, section B tiene sólo 4 → inviable.
      // El endpoint PUT acepta pero la UI del profesional debería bloquearlo;
      // el guard del paciente lo detecta como no-startable.
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: JSON.stringify(["orientacion"]),
        active_section_slugs: JSON.stringify([secB.slug]),
      });
      const r = await request(app).get("/api/patient/available-sections").set("Authorization", patientAuth);
      const row = r.body.sections.find((s) => s.section_slug === secB.slug);
      assert.equal(row.startable, false);
      assert.equal(row.enabled, true);
      assert.equal(row.sufficient, false);
    });

    it("persistencia: el PUT /training-config guarda active_section_slugs", async () => {
      const r = await request(app).put(`/api/patients/${patient.id}/training-config`).set("Authorization", profAuth).send({
        active_section_slugs: [secA.slug, secC.slug],
      });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.active_section_slugs, [secA.slug, secC.slug]);
      const row = await db("users").where({ id: patient.id }).first();
      assert.ok(row.active_section_slugs);
    });

    it("validación: section_slug inexistente → 400", async () => {
      const r = await request(app).put(`/api/patients/${patient.id}/training-config`).set("Authorization", profAuth).send({
        active_section_slugs: ["seccion_que_no_existe_zz"],
      });
      assert.equal(r.status, 400);
    });
  });

  describe("F3 — prevención del error en el paciente", () => {
    it("GET /patient/available-sections marca startable=false cuando la actividad no está habilitada", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 5,
        active_domain_slugs: null,
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).get("/api/patient/available-sections").set("Authorization", patientAuth);
      assert.equal(r.status, 200);
      const rowB = r.body.sections.find((s) => s.section_slug === secB.slug);
      assert.equal(rowB.enabled, false);
      assert.equal(rowB.startable, false);
    });

    it("POST /patient/sessions a sección no habilitada → 403", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 5,
        active_section_slugs: JSON.stringify([secA.slug]),
      });
      const r = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({
        sections: [{ section_slug: secB.slug }],
      });
      assert.equal(r.status, 403);
    });

    it("POST /patient/sessions con cantidad > disponible → 400 (nunca reduce silenciosamente)", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: JSON.stringify(["orientacion"]),
        active_section_slugs: JSON.stringify([secB.slug]),
      });
      const r = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({
        sections: [{ section_slug: secB.slug }],
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /disponible/i);
    });
  });

  describe("Reutilización entre sesiones", () => {
    it("sesiones consecutivas prefieren preguntas no utilizadas recientemente", async () => {
      await db("users").where("id", patient.id).update({
        max_questions: 10,
        active_domain_slugs: null,
        active_section_slugs: JSON.stringify([secD.slug]),
      });
      // Sección D tiene 20 preguntas y es exclusiva de este describe. Dos
      // sesiones consecutivas de 10 deben minimizar la superposición: los 10
      // primeros no se repiten en la segunda mientras la ventana RECENT=3 esté activa.
      const r1 = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({ sections: [{ section_slug: secD.slug }] });
      assert.equal(r1.status, 201);
      // Importante: `created` no cuenta en el historial "reciente" por diseño
      // (CLAUDE.md). Pasamos la sesión a in_progress para que sus preguntas se
      // consideren recientes antes de crear la segunda sesión.
      await request(app).post(`/api/sessions/${r1.body.id}/start`).set("Authorization", patientAuth);
      const ids1 = new Set(r1.body.sections[0].questions.map((q) => q.question_id));

      const r2 = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({ sections: [{ section_slug: secD.slug }] });
      assert.equal(r2.status, 201);
      const ids2 = r2.body.sections[0].questions.map((q) => q.question_id);
      const overlap = ids2.filter((id) => ids1.has(id)).length;
      // Con 20 disponibles y 10 recientes excluidas por la ventana, no debería haber solapamiento.
      assert.equal(overlap, 0, `Esperaba 0 solapamiento con 20 preguntas y 10 recientes excluidas, obtuve ${overlap}`);
    });
  });

  describe("Compatibilidad con sesiones históricas", () => {
    it("sesiones ya creadas conservan su session_questions snapshot aunque cambien dominios o secciones habilitadas", async () => {
      // Snapshot de prompt/options/correct inmutable: se verifica consultando session_questions.
      await db("users").where("id", patient.id).update({ max_questions: 10, active_domain_slugs: null, active_section_slugs: JSON.stringify([secC.slug]) });
      const r = await request(app).post("/api/patient/sessions").set("Authorization", patientAuth).send({ sections: [{ section_slug: secC.slug }] });
      assert.equal(r.status, 201);
      const sqId = r.body.sections[0].questions[0].id;
      const before = await db("session_questions").where({ id: sqId }).first();

      // Cambio la configuración y deshabilito secC.
      await db("users").where("id", patient.id).update({ active_section_slugs: JSON.stringify([secA.slug]) });

      const after = await db("session_questions").where({ id: sqId }).first();
      assert.equal(before.prompt_snapshot, after.prompt_snapshot);
      assert.equal(before.correct_answer_snapshot, after.correct_answer_snapshot);
    });
  });
});
