import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

async function cleanTestData() {
  await db("session_results").whereIn("session_id", db("sessions").select("id").whereIn("patient_id", db("users").select("id").where("email", "like", "%@auth-test.com"))).del();
  await db("answers").whereIn("session_question_id", db("session_questions").select("id")).del();
  await db("session_questions").whereIn("session_section_id", db("session_sections").select("id").whereIn("session_id", db("sessions").select("id").whereIn("patient_id", db("users").select("id").where("email", "like", "%@auth-test.com")))).del();
  await db("session_sections").whereIn("session_id", db("sessions").select("id").whereIn("patient_id", db("users").select("id").where("email", "like", "%@auth-test.com"))).del();
  await db("sessions").whereIn("patient_id", db("users").select("id").where("email", "like", "%@auth-test.com")).del();
  await db("users").where("email", "like", "%@auth-test.com").del();
}

describe("Auth API", () => {
  before(async () => {
    await cleanTestData();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("POST /api/auth/register", () => {
    it("registers a professional successfully", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Dra. García",
        email: "garcia@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.role, "professional");
      assert.equal(res.body.user.name, "Dra. García");
      assert.equal(res.body.user.email, "garcia@auth-test.com");
      assert.ok(res.body.token);
      assert.equal(res.body.user.password_hash, undefined);
    });

    it("normalizes email to lowercase", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Dr. Upper",
        email: "UPPER@Auth-Test.com",
        password: "segura123",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.email, "upper@auth-test.com");
    });

    it("returns 409 for duplicate email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Otra García",
        email: "garcia@auth-test.com",
        password: "otra123456",
      });
      assert.equal(res.status, 409);
      assert.ok(res.body.error.includes("registrado"));
    });

    it("returns 400 for missing name", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "missing-name@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 400);
    });

    it("returns 400 for missing email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Sin Email",
        password: "segura123",
      });
      assert.equal(res.status, 400);
    });

    it("returns 400 for missing password", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Sin Clave",
        email: "sin-clave@auth-test.com",
      });
      assert.equal(res.status, 400);
    });

    it("returns 400 for short password", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Clave Corta",
        email: "corta@auth-test.com",
        password: "abc",
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("6"));
    });

    it("returns 400 for invalid email format", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Email Malo",
        email: "not-an-email",
        password: "segura123",
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("email"));
    });

    it("trims whitespace from name", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "  Dra. Espacios  ",
        email: "espacios@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.name, "Dra. Espacios");
    });
  });

  describe("POST /api/auth/login", () => {
    it("logs in with correct credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "garcia@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "garcia@auth-test.com");
      assert.equal(res.body.user.role, "professional");
      assert.ok(res.body.token);
      assert.equal(res.body.user.password_hash, undefined);
    });

    it("login is case-insensitive for email", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "GARCIA@Auth-Test.com",
        password: "segura123",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "garcia@auth-test.com");
    });

    it("returns 401 for wrong password", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "garcia@auth-test.com",
        password: "wrongpassword",
      });
      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("incorrectas"));
    });

    it("returns 401 for non-existent user", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "noexiste@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("incorrectas"));
    });

    it("returns 400 for missing email", async () => {
      const res = await request(app).post("/api/auth/login").send({
        password: "segura123",
      });
      assert.equal(res.status, 400);
    });

    it("returns 400 for missing password", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "garcia@auth-test.com",
      });
      assert.equal(res.status, 400);
    });

    it("does not allow patient login through auth/login", async () => {
      await db("users").insert({
        role: "patient",
        name: "Paciente Auth",
        email: "paciente@auth-test.com",
        age: 70,
      });
      const res = await request(app).post("/api/auth/login").send({
        email: "paciente@auth-test.com",
        password: "cualquiera",
      });
      assert.equal(res.status, 401);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns current user with valid token", async () => {
      const loginRes = await request(app).post("/api/auth/login").send({
        email: "garcia@auth-test.com",
        password: "segura123",
      });
      const token = loginRes.body.token;

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "garcia@auth-test.com");
      assert.equal(res.body.user.role, "professional");
    });

    it("returns 401 without token", async () => {
      const res = await request(app).get("/api/auth/me");
      assert.equal(res.status, 401);
    });

    it("returns 401 with invalid token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer invalid-token-here");
      assert.equal(res.status, 401);
    });

    it("returns 401 with malformed header", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "NotBearer sometoken");
      assert.equal(res.status, 401);
    });
  });

  describe("Protected routes", () => {
    it("POST /api/sessions returns 401 without token", async () => {
      const res = await request(app).post("/api/sessions").send({
        patient_id: 1,
        professional_id: 1,
        sections: [{ section_id: 1, question_count: 1 }],
      });
      assert.equal(res.status, 401);
    });

    it("GET /api/sessions/:id/results returns 401 without token", async () => {
      const res = await request(app).get("/api/sessions/1/results");
      assert.equal(res.status, 401);
    });

    it("patient token cannot create sessions", async () => {
      const patientUser = await db("users")
        .where({ email: "paciente@auth-test.com", role: "patient" })
        .first();
      const patientAuth = authHeaderFor(patientUser);

      const res = await request(app)
        .post("/api/sessions")
        .set("Authorization", patientAuth)
        .send({
          patient_id: patientUser.id,
          professional_id: 1,
          sections: [{ section_id: 1, question_count: 1 }],
        });
      assert.equal(res.status, 403);
    });

    it("patient token cannot access results", async () => {
      const patientUser = await db("users")
        .where({ email: "paciente@auth-test.com", role: "patient" })
        .first();
      const patientAuth = authHeaderFor(patientUser);

      const res = await request(app)
        .get("/api/sessions/1/results")
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
    });
  });

  describe("Security", () => {
    it("password_hash is never returned in register response", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Security Check",
        email: "security@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.body.user.password_hash, undefined);
      assert.equal(JSON.stringify(res.body).includes("password_hash"), false);
    });

    it("password_hash is never returned in login response", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "security@auth-test.com",
        password: "segura123",
      });
      assert.equal(res.body.user.password_hash, undefined);
      assert.equal(JSON.stringify(res.body).includes("password_hash"), false);
    });

    it("password is stored as hash, not plain text", async () => {
      const user = await db("users")
        .where("email", "security@auth-test.com")
        .first();
      assert.ok(user.password_hash);
      assert.notEqual(user.password_hash, "segura123");
      assert.ok(user.password_hash.startsWith("$2"));
    });
  });
});
