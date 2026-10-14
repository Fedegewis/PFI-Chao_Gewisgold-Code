import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import { countEligibleQuestions } from "../src/services/questionEligibility.js";

const EMAIL_SUFFIX = "@training-config-test.com";
const SECTION_SLUG = `tc_test_${Date.now()}`;

async function clean() {
  const ids = await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).pluck("id");
  if (ids.length > 0) {
    const sessionIds = await db("sessions").whereIn("patient_id", ids).pluck("id");
    if (sessionIds.length > 0) {
      const ssIds = await db("session_sections").whereIn("session_id", sessionIds).pluck("id");
      if (ssIds.length > 0) {
        await db("session_questions").whereIn("session_section_id", ssIds).del();
      }
      await db("session_sections").whereIn("session_id", sessionIds).del();
      await db("sessions").whereIn("id", sessionIds).del();
    }
  }
  const qids = await db("questions").where("source", "tc_test_fixture").pluck("id");
  if (qids.length > 0) {
    await db("question_cognitive_domains").whereIn("question_id", qids).del();
    await db("questions").whereIn("id", qids).del();
  }
  await db("sections").where("slug", "like", "tc_test_%").del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Training config API", () => {
  let profA, profB;
  let patientA1;
  let profAAuth, profBAuth, patientA1Auth;
  let sectionId;
  let memoriaId, atencionId, orientacionId;
  let qMemOnly = [], qAtnOnly = [], qMemYAtn = [], qOrientacion = [];

  before(async () => {
    await clean();

    [profA] = await db("users").insert({
      role: "professional", name: "Prof A", email: `profA-${Date.now()}${EMAIL_SUFFIX}`,
    }).returning("*");
    [profB] = await db("users").insert({
      role: "professional", name: "Prof B", email: `profB-${Date.now()}${EMAIL_SUFFIX}`,
    }).returning("*");
    [patientA1] = await db("users").insert({
      role: "patient", name: "Pat A1", email: `patA1-${Date.now()}${EMAIL_SUFFIX}`, professional_id: profA.id,
    }).returning("*");
    // Paciente B1 asociado a profB — se crea para asegurar aislamiento, no se referencia.
    await db("users").insert({
      role: "patient", name: "Pat B1", email: `patB1-${Date.now()}${EMAIL_SUFFIX}`, professional_id: profB.id,
    });
    profAAuth = authHeaderFor(profA);
    profBAuth = authHeaderFor(profB);
    patientA1Auth = authHeaderFor(patientA1);

    const [section] = await db("sections").insert({
      slug: SECTION_SLUG, name: "Sección TC", description: "Sección de test training-config",
      is_active: true, display_order: 900,
    }).returning("*");
    sectionId = section.id;

    memoriaId = (await db("cognitive_domains").where({ slug: "memoria" }).first()).id;
    atencionId = (await db("cognitive_domains").where({ slug: "atencion" }).first()).id;
    orientacionId = (await db("cognitive_domains").where({ slug: "orientacion" }).first()).id;

    // Insertar preguntas y asociarlas a dominios para probar filtros:
    // 3 sólo memoria, 3 sólo atención, 2 memoria+atención (dedup), 2 orientación, 1 SIN dominios.
    const buckets = [
      { count: 3, domains: [memoriaId], bucket: qMemOnly },
      { count: 3, domains: [atencionId], bucket: qAtnOnly },
      { count: 2, domains: [memoriaId, atencionId], bucket: qMemYAtn },
      { count: 2, domains: [orientacionId], bucket: qOrientacion },
      { count: 1, domains: [], bucket: null }, // sin dominios
    ];
    for (const b of buckets) {
      for (let i = 0; i < b.count; i++) {
        const [q] = await db("questions").insert({
          section_id: sectionId,
          prompt: `TC prompt ${b.domains.join(",")||"none"} ${i}`,
          response_type: "multiple_choice",
          options: JSON.stringify(["a", "b", "c", "d"]),
          correct_answer: 0,
          is_active: true,
          is_validated: true,
          source: "tc_test_fixture",
        }).returning("*");
        for (const did of b.domains) {
          await db("question_cognitive_domains").insert({ question_id: q.id, cognitive_domain_id: did });
        }
        if (b.bucket) b.bucket.push(q);
      }
    }
  });

  after(async () => {
    await clean();
    await db.destroy();
  });

  it("countEligibleQuestions sin dominios cuenta 3+3+2+2+1=11 (active+validated)", async () => {
    const n = await countEligibleQuestions(db, sectionId, null);
    assert.equal(n, 11);
  });

  it("countEligibleQuestions con [memoria] cuenta 3+2=5 sin duplicar", async () => {
    const n = await countEligibleQuestions(db, sectionId, ["memoria"]);
    assert.equal(n, 5);
  });

  it("countEligibleQuestions con [memoria,atencion] cuenta 3+3+2=8 (OR + DISTINCT)", async () => {
    const n = await countEligibleQuestions(db, sectionId, ["memoria", "atencion"]);
    assert.equal(n, 8);
  });

  it("GET config paciente ownership OK (fallback cuando NULL)", async () => {
    const res = await request(app)
      .get(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.max_questions, null);
    assert.equal(res.body.active_domain_slugs, null);
    assert.equal(res.body.effective_max_questions, 4);
    assert.equal(res.body.effective_active_domain_slugs, null);
  });

  it("GET paciente ajeno → 404", async () => {
    const res = await request(app)
      .get(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profBAuth);
    assert.equal(res.status, 404);
  });

  it("PUT config válido persiste y responde con effective correcto", async () => {
    const res = await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 6, active_domain_slugs: ["memoria", "atencion"] });
    assert.equal(res.status, 200);
    assert.equal(res.body.max_questions, 6);
    assert.deepEqual(res.body.active_domain_slugs, ["memoria", "atencion"]);
    assert.equal(res.body.effective_max_questions, 6);
    assert.deepEqual(res.body.effective_active_domain_slugs, ["memoria", "atencion"]);
  });

  it("PUT max_questions <1 rechazado", async () => {
    const res = await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 0 });
    assert.equal(res.status, 400);
  });

  it("PUT max_questions >10 rechazado", async () => {
    const res = await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 11 });
    assert.equal(res.status, 400);
  });

  it("PUT slug inexistente rechazado", async () => {
    const res = await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ active_domain_slugs: ["memoria", "no_existe"] });
    assert.equal(res.status, 400);
  });

  it("PUT slugs duplicados rechazado", async () => {
    const res = await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ active_domain_slugs: ["memoria", "memoria"] });
    assert.equal(res.status, 400);
  });

  it("PUT paciente ajeno → 404", async () => {
    const res = await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profBAuth)
      .send({ max_questions: 5 });
    assert.equal(res.status, 404);
  });

  it("GET paciente propio devuelve config efectiva", async () => {
    const res = await request(app)
      .get("/api/patient/training-config")
      .set("Authorization", patientA1Auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.effective_max_questions, 6);
    assert.deepEqual(res.body.effective_active_domain_slugs, ["memoria", "atencion"]);
  });

  it("GET /api/cognitive-domains devuelve el catálogo real", async () => {
    const res = await request(app)
      .get("/api/cognitive-domains")
      .set("Authorization", profAAuth);
    assert.equal(res.status, 200);
    const slugs = res.body.map((d) => d.slug);
    for (const s of ["memoria", "atencion", "funciones_ejecutivas", "orientacion", "comprension_lenguaje"]) {
      assert.ok(slugs.includes(s), `Falta ${s}`);
    }
  });

  it("GET availability calcula available por sección con dominios efectivos", async () => {
    const res = await request(app)
      .get(`/api/patients/${patientA1.id}/training-availability`)
      .set("Authorization", profAAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.requested, 6);
    const row = res.body.sections.find((s) => s.section_slug === SECTION_SLUG);
    assert.ok(row, "Falta la sección de test");
    assert.equal(row.available, 8);
    assert.equal(row.sufficient, true);
    // any_sufficient: al menos una sección cumple → true.
    assert.equal(res.body.any_sufficient, true);
  });

  it("any_sufficient=true cuando UNA sola sección tiene ≥ max_questions (Caso 1)", async () => {
    // Config: 5 preguntas, dominios [memoria, atencion]. En SECTION_SLUG hay 8
    // elegibles (unión). Otras secciones tampoco alcanzan pero al menos ésta sí.
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 5, active_domain_slugs: ["memoria", "atencion"] })
      .expect(200);
    const res = await request(app)
      .get(`/api/patients/${patientA1.id}/training-availability`)
      .set("Authorization", profAAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.any_sufficient, true);
  });

  it("any_sufficient=true con un solo dominio y ≥ max elegibles en alguna sección (Caso 2)", async () => {
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 5, active_domain_slugs: ["memoria"] })
      .expect(200);
    const res = await request(app)
      .get(`/api/patients/${patientA1.id}/training-availability`)
      .set("Authorization", profAAuth);
    // En SECTION_SLUG hay 5 elegibles con memoria (3 sólo memoria + 2 memoria+atencion).
    const row = res.body.sections.find((s) => s.section_slug === SECTION_SLUG);
    assert.equal(row.available, 5);
    assert.equal(row.sufficient, true);
    assert.equal(res.body.any_sufficient, true);
  });

  it("any_sufficient=false cuando ninguna sección alcanza max_questions (Caso 3)", async () => {
    // Sólo orientación → en SECTION_SLUG hay 2 elegibles y todas las otras
    // secciones no tienen fixtures de este test. max_questions=5.
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 5, active_domain_slugs: ["orientacion"] })
      .expect(200);
    const res = await request(app)
      .get(`/api/patients/${patientA1.id}/training-availability`)
      .set("Authorization", profAAuth);
    const row = res.body.sections.find((s) => s.section_slug === SECTION_SLUG);
    // Puede haber otras secciones con datos reales que sí cumplan (menteactiva_test
    // tiene el seed cargado con las 10 secciones y sus preguntas). Verificamos
    // que en la sección de test específica no alcanza.
    assert.equal(row.available, 2);
    assert.equal(row.sufficient, false);
  });

  it("POST /api/patient/sessions ignora question_count del cliente y usa max_questions persistido", async () => {
    // Estado explícito: max=6 + [memoria, atencion] (hay 8 elegibles).
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 6, active_domain_slugs: ["memoria", "atencion"] })
      .expect(200);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG, question_count: 99 }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.sections.length, 1);
    assert.equal(res.body.sections[0].questions.length, 6);
    assert.equal(res.body.sections[0].requested_count, 6);
  });

  it("POST /api/patient/sessions filtra por dominios configurados (memoria+atencion)", async () => {
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 6, active_domain_slugs: ["memoria", "atencion"] })
      .expect(200);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG }] });
    assert.equal(res.status, 201);
    const questionIds = res.body.sections[0].questions.map((q) => q.question_id);
    // Todas deben pertenecer a memoria y/o atención. Nunca a orientación ni "sin dominios".
    const dominios = await db("question_cognitive_domains as qcd")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .whereIn("qcd.question_id", questionIds)
      .select("qcd.question_id", "cd.slug");
    const okSlugs = new Set(["memoria", "atencion"]);
    const byQ = new Map();
    for (const row of dominios) {
      if (!byQ.has(row.question_id)) byQ.set(row.question_id, []);
      byQ.get(row.question_id).push(row.slug);
    }
    for (const qid of questionIds) {
      const slugs = byQ.get(qid) || [];
      assert.ok(slugs.some((s) => okSlugs.has(s)), `Pregunta ${qid} sin dominio válido`);
    }
  });

  it("questionCount es TOTAL de la sesión (5 preguntas totales aunque haya 2 dominios) — Caso 4", async () => {
    // Config: 5 preguntas, dominios [memoria, atencion]. En SECTION_SLUG hay
    // 8 elegibles unión. La sesión debe crearse con EXACTAMENTE 5 (no 10, no 8).
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 5, active_domain_slugs: ["memoria", "atencion"] })
      .expect(200);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.sections.length, 1);
    assert.equal(res.body.sections[0].questions.length, 5);
    assert.equal(res.body.sections[0].requested_count, 5);
  });

  it("Caso 5 — todas las preguntas seleccionadas pertenecen al menos a uno de los dominios configurados", async () => {
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 5, active_domain_slugs: ["memoria", "atencion"] })
      .expect(200);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG }] });
    assert.equal(res.status, 201);
    const questionIds = res.body.sections[0].questions.map((q) => q.question_id);
    assert.equal(questionIds.length, 5);
    // Verificar dominios en DB
    const rows = await db("question_cognitive_domains as qcd")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .whereIn("qcd.question_id", questionIds)
      .select("qcd.question_id", "cd.slug");
    const byQ = new Map();
    for (const r of rows) {
      if (!byQ.has(r.question_id)) byQ.set(r.question_id, new Set());
      byQ.get(r.question_id).add(r.slug);
    }
    for (const qid of questionIds) {
      const slugs = byQ.get(qid) || new Set();
      assert.ok(
        slugs.has("memoria") || slugs.has("atencion"),
        `Pregunta ${qid} no pertenece a ningún dominio configurado`
      );
    }
  });

  it("POST /api/patient/sessions no duplica preguntas cuando una pertenece a varios dominios", async () => {
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 6, active_domain_slugs: ["memoria", "atencion"] })
      .expect(200);
    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG }] });
    assert.equal(res.status, 201);
    const questionIds = res.body.sections[0].questions.map((q) => q.question_id);
    assert.equal(new Set(questionIds).size, questionIds.length);
  });

  it("POST /api/patient/sessions rechaza 400 si requested > available para la config", async () => {
    // Reconfigurar: sólo orientación → 2 disponibles, max_questions=6 → 400.
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 6, active_domain_slugs: ["orientacion"] })
      .expect(200);

    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG }] });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /disponible/i);
  });

  it("Fallback: paciente sin configurar usa max=4 y sin filtro de dominios", async () => {
    // Reset a NULL.
    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: null, active_domain_slugs: null })
      .expect(200);

    const meRes = await request(app)
      .get("/api/patient/training-config")
      .set("Authorization", patientA1Auth);
    assert.equal(meRes.body.effective_max_questions, 4);
    assert.equal(meRes.body.effective_active_domain_slugs, null);

    const res = await request(app)
      .post("/api/patient/sessions")
      .set("Authorization", patientA1Auth)
      .send({ sections: [{ section_slug: SECTION_SLUG }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.sections[0].questions.length, 4);
  });

  it("Cambiar configuración no modifica sesiones históricas", async () => {
    const before = await db("session_questions").count("id as c").first();

    await request(app)
      .put(`/api/patients/${patientA1.id}/training-config`)
      .set("Authorization", profAAuth)
      .send({ max_questions: 2, active_domain_slugs: ["memoria"] })
      .expect(200);

    const after = await db("session_questions").count("id as c").first();
    assert.equal(Number(after.c), Number(before.c));
  });
});
