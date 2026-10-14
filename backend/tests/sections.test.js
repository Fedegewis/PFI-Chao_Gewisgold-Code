import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

let professionalAuth;
let patientAuth;
let cleanupUserIds = [];

describe("API", () => {
  before(async () => {
    const [prof] = await db("users")
      .insert({ role: "professional", name: "Dr. Sections", email: `sections-prof-${Date.now()}@test.com` })
      .returning("*");
    const [pat] = await db("users")
      .insert({ role: "patient", name: "Pac Sections", email: `sections-pat-${Date.now()}@test.com`, professional_id: prof.id, age: 70 })
      .returning("*");
    professionalAuth = authHeaderFor(prof);
    patientAuth = authHeaderFor(pat);
    cleanupUserIds = [pat.id, prof.id];
  });

  after(async () => {
    if (cleanupUserIds.length > 0) {
      await db("users").whereIn("id", cleanupUserIds).del();
    }
    await db.destroy();
  });

  describe("GET /api/health", () => {
    it("returns ok when database is reachable", async () => {
      const res = await request(app).get("/api/health");
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "ok");
      assert.ok(res.body.timestamp);
    });
  });

  describe("GET /api/sections", () => {
    it("returns all 10 active sections ordered by display_order", async () => {
      const res = await request(app).get("/api/sections");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 10);

      for (const section of res.body) {
        assert.ok(section.id);
        assert.ok(section.name);
        assert.ok(section.slug);
      }

      const orders = res.body.map((s) => s.display_order);
      const sorted = [...orders].sort((a, b) => a - b);
      assert.deepEqual(orders, sorted, "Sections should be ordered by display_order");
    });

    it("includes all 10 expected section slugs", async () => {
      const res = await request(app).get("/api/sections");
      const slugs = res.body.map((s) => s.slug);

      const expected = [
        "memoria_de_trabajo",
        "atencion_y_calculo",
        "funciones_ejecutivas",
        "orientacion_temporal",
        "memoria_asociativa",
        "metacognicion",
        "memoria_prospectiva",
        "atencion_visual",
        "comprension_funcional",
        "orientacion_espacial",
      ];

      for (const slug of expected) {
        assert.ok(slugs.includes(slug), `Missing expected section: ${slug}`);
      }
    });

    it("does not include cognitive_domain in response", async () => {
      const res = await request(app).get("/api/sections");
      for (const section of res.body) {
        assert.equal(
          section.cognitive_domain,
          undefined,
          "cognitive_domain column should not be in response"
        );
      }
    });
  });

  describe("cognitive_domains table", () => {
    it("contains exactly 5 cognitive domains", async () => {
      const domains = await db("cognitive_domains").select("*").orderBy("id");
      assert.equal(domains.length, 5);

      const slugs = domains.map((d) => d.slug);
      assert.deepEqual(slugs, [
        "memoria",
        "atencion",
        "funciones_ejecutivas",
        "orientacion",
        "comprension_lenguaje",
      ]);
    });

    it("has correct display names", async () => {
      const domains = await db("cognitive_domains").select("*").orderBy("id");
      const names = domains.map((d) => d.name);
      assert.deepEqual(names, [
        "Memoria",
        "Atención",
        "Funciones ejecutivas",
        "Orientación",
        "Comprensión y lenguaje",
      ]);
    });
  });

  describe("question_cognitive_domains table", () => {
    it("exists and accepts inserts with valid FKs", async () => {
      const [domain] = await db("cognitive_domains").where("slug", "memoria").select("id");
      const [question] = await db("questions").where("source", "legacy_seed_v1").limit(1).select("id");

      await db("question_cognitive_domains")
        .insert({ question_id: question.id, cognitive_domain_id: domain.id })
        .onConflict(["question_id", "cognitive_domain_id"])
        .ignore();

      const row = await db("question_cognitive_domains")
        .where({ question_id: question.id, cognitive_domain_id: domain.id })
        .first();
      assert.ok(row);

      await db("question_cognitive_domains")
        .where({ question_id: question.id, cognitive_domain_id: domain.id })
        .del();
    });

    it("enforces unique constraint on (question_id, cognitive_domain_id)", async () => {
      const [domain] = await db("cognitive_domains").where("slug", "atencion").select("id");
      const [question] = await db("questions").where("source", "legacy_seed_v1").limit(1).select("id");

      await db("question_cognitive_domains")
        .insert({ question_id: question.id, cognitive_domain_id: domain.id });

      await assert.rejects(
        () => db("question_cognitive_domains")
          .insert({ question_id: question.id, cognitive_domain_id: domain.id }),
        (err) => err.code === "23505"
      );

      await db("question_cognitive_domains")
        .where({ question_id: question.id, cognitive_domain_id: domain.id })
        .del();
    });

    it("allows a question to have multiple domains", async () => {
      const domains = await db("cognitive_domains").select("id").limit(2);
      const [question] = await db("questions").where("source", "legacy_seed_v1").limit(1).select("id");

      await db("question_cognitive_domains").insert([
        { question_id: question.id, cognitive_domain_id: domains[0].id },
        { question_id: question.id, cognitive_domain_id: domains[1].id },
      ]);

      const rows = await db("question_cognitive_domains")
        .where("question_id", question.id)
        .select("*");
      assert.equal(rows.length, 2);

      await db("question_cognitive_domains")
        .where("question_id", question.id)
        .del();
    });
  });

  describe("questions", () => {
    it("has 43 legacy questions", async () => {
      const [{ count }] = await db("questions")
        .where("source", "legacy_seed_v1")
        .count("id as count");
      assert.equal(Number(count), 43);
    });

    it("has subdimension column", async () => {
      const [question] = await db("questions").limit(1).select("*");
      assert.ok("subdimension" in question, "subdimension column should exist");
    });

    it("legacy questions have is_validated=false", async () => {
      const validated = await db("questions")
        .where({ source: "legacy_seed_v1", is_validated: true })
        .count("id as count");
      assert.equal(Number(validated[0].count), 0);
    });

    it("no question was deleted", async () => {
      const [{ count }] = await db("questions").count("id as count");
      assert.ok(Number(count) >= 43, "Should have at least 43 questions");
    });
  });

  describe("GET /api/sections/:id/questions", () => {
    it("returns questions for a valid section (professional auth)", async () => {
      const sectionsRes = await request(app).get("/api/sections");
      const memoriaSection = sectionsRes.body.find(
        (s) => s.slug === "memoria_de_trabajo"
      );

      const res = await request(app)
        .get(`/api/sections/${memoriaSection.id}/questions`)
        .set("Authorization", professionalAuth);
      assert.equal(res.status, 200);
      assert.ok(res.body.section);
      assert.equal(res.body.section.slug, "memoria_de_trabajo");
      assert.ok(Array.isArray(res.body.questions));
      // Al menos 35 (5 legacy + 30 bank_v1). bank_v2 agrega más — se cuenta
      // con >= para no romper al ampliarse el banco en el futuro.
      assert.ok(res.body.questions.length >= 35, `Expected >=35 questions, got ${res.body.questions.length}`);

      const legacy = res.body.questions.filter(
        (q) => q.source === "legacy_seed_v1"
      );
      assert.equal(legacy.length, 5);

      const mt = res.body.questions.filter(
        (q) => q.source === "bank_v1"
      );
      assert.equal(mt.length, 30);

      const q = res.body.questions[0];
      assert.ok(q.prompt);
      assert.ok(Array.isArray(q.options));
      assert.equal(q.response_type, "multiple_choice");
      assert.equal(q.is_validated, false);
    });

    // 6E.1 (H2): endpoint requiere auth y no debe exponer correct_answer.
    it("returns 401 without auth (6E.1 H2)", async () => {
      const sectionsRes = await request(app).get("/api/sections");
      const memoriaSection = sectionsRes.body.find((s) => s.slug === "memoria_de_trabajo");
      const res = await request(app).get(`/api/sections/${memoriaSection.id}/questions`);
      assert.equal(res.status, 401);
    });

    it("does NOT return correct_answer to professional (6E.1 H2)", async () => {
      const sectionsRes = await request(app).get("/api/sections");
      const memoriaSection = sectionsRes.body.find((s) => s.slug === "memoria_de_trabajo");
      const res = await request(app)
        .get(`/api/sections/${memoriaSection.id}/questions`)
        .set("Authorization", professionalAuth);
      assert.equal(res.status, 200);
      for (const q of res.body.questions) {
        assert.equal(q.correct_answer, undefined, "correct_answer must not appear");
        assert.equal(q.correct_answer_snapshot, undefined, "correct_answer_snapshot must not appear");
        assert.equal(q.scoring_value, undefined, "scoring_value must not appear (could leak scoring)");
        assert.equal(q.feedback_correct, undefined, "feedback_correct must not appear (identifica opción correcta)");
        assert.equal(q.feedback_incorrect, undefined, "feedback_incorrect must not appear");
      }
    });

    it("does NOT return correct_answer to patient (6E.1 H2)", async () => {
      const sectionsRes = await request(app).get("/api/sections");
      const memoriaSection = sectionsRes.body.find((s) => s.slug === "memoria_de_trabajo");
      const res = await request(app)
        .get(`/api/sections/${memoriaSection.id}/questions`)
        .set("Authorization", patientAuth);
      assert.equal(res.status, 200);
      for (const q of res.body.questions) {
        assert.equal(q.correct_answer, undefined);
        assert.equal(q.correct_answer_snapshot, undefined);
      }
    });

    it("returns 404 for non-existent section", async () => {
      const res = await request(app)
        .get("/api/sections/99999/questions")
        .set("Authorization", professionalAuth);
      assert.equal(res.status, 404);
    });

    it("returns 400 for invalid section id", async () => {
      const res = await request(app)
        .get("/api/sections/abc/questions")
        .set("Authorization", professionalAuth);
      assert.equal(res.status, 400);
    });
  });
});
