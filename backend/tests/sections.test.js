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
      assert.equal(res.body.length, 10);
      assert.equal(res.body[0].slug, "memoria_de_trabajo");
      assert.equal(res.body[9].slug, "orientacion_espacial");

      for (const section of res.body) {
        assert.ok(section.id);
        assert.ok(section.name);
        assert.ok(section.slug);
      }
    });
  });

  describe("GET /api/sections/:id/questions", () => {
    it("returns questions for a valid section", async () => {
      const sectionsRes = await request(app).get("/api/sections");
      const firstSection = sectionsRes.body[0];

      const res = await request(app).get(`/api/sections/${firstSection.id}/questions`);
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
