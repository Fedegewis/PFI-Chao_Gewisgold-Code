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

    it("rejects patient login when the user has no password_hash", async () => {
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
      assert.ok(res.body.error.includes("incorrectas"));
    });

    it("allows a patient with password_hash to log in and returns role='patient' in the JWT", async () => {
      const bcrypt = (await import("bcrypt")).default;
      const jwt = (await import("jsonwebtoken")).default;
      const passwordHash = await bcrypt.hash("paciente-pass", 10);

      const [professional] = await db("users")
        .insert({
          role: "professional",
          name: "Prof Owner",
          email: "prof-owner@auth-test.com",
        })
        .returning("*");

      await db("users").insert({
        role: "patient",
        name: "Paciente Login",
        email: "paciente-login@auth-test.com",
        age: 68,
        password_hash: passwordHash,
        professional_id: professional.id,
        auth_provider: "local",
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "paciente-login@auth-test.com",
        password: "paciente-pass",
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, "patient");
      assert.equal(res.body.user.email, "paciente-login@auth-test.com");
      assert.equal(res.body.user.password_hash, undefined);
      assert.equal(res.body.user.google_id, undefined);
      assert.ok(res.body.token);

      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      assert.equal(decoded.role, "patient");
    });

    it("ignores role sent in the body when logging in", async () => {
      const bcrypt = (await import("bcrypt")).default;
      const passwordHash = await bcrypt.hash("paciente-pass", 10);

      await db("users").insert({
        role: "patient",
        name: "Paciente Role Hijack",
        email: "hijack@auth-test.com",
        age: 70,
        password_hash: passwordHash,
        auth_provider: "local",
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "hijack@auth-test.com",
        password: "paciente-pass",
        role: "professional",
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, "patient");
    });

    it("rejects an inactive patient", async () => {
      const bcrypt = (await import("bcrypt")).default;
      const passwordHash = await bcrypt.hash("paciente-pass", 10);

      await db("users").insert({
        role: "patient",
        name: "Paciente Inactivo",
        email: "inactive-patient@auth-test.com",
        password_hash: passwordHash,
        auth_provider: "local",
        is_active: false,
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "inactive-patient@auth-test.com",
        password: "paciente-pass",
      });
      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("incorrectas"));
    });

    it("rejects an inactive professional", async () => {
      const bcrypt = (await import("bcrypt")).default;
      const passwordHash = await bcrypt.hash("prof-pass", 10);

      await db("users").insert({
        role: "professional",
        name: "Prof Inactivo",
        email: "inactive-prof@auth-test.com",
        password_hash: passwordHash,
        auth_provider: "local",
        is_active: false,
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "inactive-prof@auth-test.com",
        password: "prof-pass",
      });
      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("incorrectas"));
    });

    it("allows a patient created via the invitation flow to log in later", async () => {
      const [professional] = await db("users")
        .insert({
          role: "professional",
          name: "Prof Invite",
          email: "prof-invite@auth-test.com",
        })
        .returning("*");

      const profToken = authHeaderFor(professional);
      const inviteEmail = `invited-${Date.now()}@auth-test.com`;
      const invRes = await request(app)
        .post("/api/invitations")
        .set("Authorization", profToken)
        .send({ name: "Invitado", age: 66, email: inviteEmail });
      assert.equal(invRes.status, 201);

      const acceptRes = await request(app)
        .post(`/api/invitations/${invRes.body.token}/accept`)
        .send({ password: "invitado123" });
      assert.equal(acceptRes.status, 201);

      const loginRes = await request(app).post("/api/auth/login").send({
        email: inviteEmail,
        password: "invitado123",
      });
      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.body.user.role, "patient");
      assert.equal(loginRes.body.user.email, inviteEmail);
      assert.equal(loginRes.body.user.password_hash, undefined);

      const dbUser = await db("users").where({ email: inviteEmail }).first();
      assert.equal(dbUser.professional_id, professional.id);
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
