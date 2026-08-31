import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";

describe("API", () => {
  after(async () => {
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
    it("returns all active sections ordered by display_order", async () => {
      const res = await request(app).get("/api/sections");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 11);

      for (const section of res.body) {
        assert.ok(section.id);
        assert.ok(section.name);
        assert.ok(section.slug);
      }

      const slugs = res.body.map((s) => s.slug);
      assert.ok(
        !slugs.includes("atencion_visual"),
        "atencion_visual should not appear among active sections"
      );
    });

    it("returns correct cognitive domain groupings", async () => {
      const res = await request(app).get("/api/sections");
      const byDomain = {};
      for (const s of res.body) {
        const domain = s.cognitive_domain || "__none__";
        byDomain[domain] = (byDomain[domain] || 0) + 1;
      }

      assert.equal(byDomain["Memoria"], 3);
      assert.equal(byDomain["Atención"], 2);
      assert.equal(byDomain["Funciones ejecutivas"], 2);
      assert.equal(byDomain["Orientación"], 2);
      assert.equal(byDomain["Comprensión y lenguaje"], 1);
      assert.equal(byDomain["__none__"], 1, "Autorreporte has no cognitive_domain");
    });

    it("includes expected section slugs", async () => {
      const res = await request(app).get("/api/sections");
      const slugs = res.body.map((s) => s.slug);

      const expected = [
        "memoria_de_trabajo",
        "memoria_asociativa",
        "memoria_prospectiva",
        "atencion_y_calculo",
        "atencion_selectiva",
        "planificacion_y_secuenciacion",
        "razonamiento_practico",
        "orientacion_temporal",
        "orientacion_espacial",
        "comprension_funcional",
        "autorreporte",
      ];

      for (const slug of expected) {
        assert.ok(slugs.includes(slug), `Missing expected section: ${slug}`);
      }
    });
  });

  describe("GET /api/sections/:id/questions", () => {
    it("returns questions for a valid section", async () => {
      const sectionsRes = await request(app).get("/api/sections");
      const memoriaSection = sectionsRes.body.find(
        (s) => s.slug === "memoria_de_trabajo"
      );

      const res = await request(app).get(
        `/api/sections/${memoriaSection.id}/questions`
      );
      assert.equal(res.status, 200);
      assert.ok(res.body.section);
      assert.equal(res.body.section.slug, "memoria_de_trabajo");
      assert.ok(Array.isArray(res.body.questions));
      assert.equal(res.body.questions.length, 5);

      const q = res.body.questions[0];
      assert.ok(q.prompt);
      assert.ok(Array.isArray(q.options));
      assert.equal(q.options.length, 3);
      assert.equal(q.response_type, "multiple_choice");
      assert.equal(typeof q.correct_answer, "number");
      assert.equal(q.is_validated, false);
      assert.equal(q.source, "legacy_seed_v1");
    });

    it("returns 404 for non-existent section", async () => {
      const res = await request(app).get("/api/sections/99999/questions");
      assert.equal(res.status, 404);
    });

    it("returns 400 for invalid section id", async () => {
      const res = await request(app).get("/api/sections/abc/questions");
      assert.equal(res.status, 400);
    });
  });
});
