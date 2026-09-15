import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import db from "../src/db/connection.js";
import { createGoogleAuthRouter } from "../src/routes/google-auth.js";
import authRouter from "../src/routes/auth.js";

function buildGooglePayload(overrides = {}) {
  return {
    sub: "google-sub-123456",
    email: "google-pro@gauth-test.com",
    email_verified: true,
    name: "Dra. Google",
    ...overrides,
  };
}

let mockPayload = buildGooglePayload();
let mockShouldThrow = false;

async function fakeVerifier() {
  if (mockShouldThrow) throw new Error("Invalid token");
  return mockPayload;
}

const app = express();
app.use(express.json());
app.use("/api", authRouter);
app.use("/api", createGoogleAuthRouter(fakeVerifier));

async function cleanTestData() {
  await db("session_results").whereIn("session_id", db("sessions").select("id").whereIn("patient_id", db("users").select("id").where("email", "like", "%@gauth-test.com"))).del();
  await db("answers").whereIn("session_question_id", db("session_questions").select("id")).del();
  await db("session_questions").whereIn("session_section_id", db("session_sections").select("id").whereIn("session_id", db("sessions").select("id").whereIn("patient_id", db("users").select("id").where("email", "like", "%@gauth-test.com")))).del();
  await db("session_sections").whereIn("session_id", db("sessions").select("id").whereIn("patient_id", db("users").select("id").where("email", "like", "%@gauth-test.com"))).del();
  await db("sessions").whereIn("patient_id", db("users").select("id").where("email", "like", "%@gauth-test.com")).del();
  await db("users").where("email", "like", "%@gauth-test.com").del();
}

describe("Google Auth API", () => {
  before(async () => {
    await cleanTestData();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("POST /api/auth/google", () => {
    it("creates new professional from Google login", async () => {
      mockPayload = buildGooglePayload();
      mockShouldThrow = false;

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(res.status, 201);
      assert.equal(res.body.user.role, "professional");
      assert.equal(res.body.user.email, "google-pro@gauth-test.com");
      assert.equal(res.body.user.name, "Dra. Google");
      assert.ok(res.body.token);
      assert.equal(res.body.user.password_hash, undefined);
      assert.equal(res.body.user.google_id, undefined);
    });

    it("logs in existing Google professional", async () => {
      mockPayload = buildGooglePayload();
      mockShouldThrow = false;

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "google-pro@gauth-test.com");
      assert.ok(res.body.token);
    });

    it("links Google to existing email/password professional", async () => {
      await db("users").insert({
        role: "professional",
        name: "Dr. Password",
        email: "password-pro@gauth-test.com",
        password_hash: "$2b$10$fakehashfakehashfakehashfakehashfakehashfakehashfa",
      });

      mockPayload = buildGooglePayload({
        sub: "google-sub-link-789",
        email: "password-pro@gauth-test.com",
        name: "Dr. Password Google",
      });
      mockShouldThrow = false;

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "password-pro@gauth-test.com");
      assert.equal(res.body.user.name, "Dr. Password");
      assert.ok(res.body.token);

      const dbUser = await db("users").where("email", "password-pro@gauth-test.com").first();
      assert.equal(dbUser.google_id, "google-sub-link-789");
    });

    it("rejects invalid Google credential", async () => {
      mockShouldThrow = true;

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "bad-token" });

      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("inválido"));
      mockShouldThrow = false;
    });

    it("rejects unverified Google email", async () => {
      mockPayload = buildGooglePayload({
        sub: "google-sub-unverified",
        email: "unverified@gauth-test.com",
        email_verified: false,
      });

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("verificado"));
    });

    it("rejects missing credential", async () => {
      const res = await request(app)
        .post("/api/auth/google")
        .send({});

      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes("credential"));
    });

    it("does not create patient via Google", async () => {
      await db("users").insert({
        role: "patient",
        name: "Paciente Existente",
        email: "paciente-google@gauth-test.com",
        age: 70,
      });

      mockPayload = buildGooglePayload({
        sub: "google-sub-patient",
        email: "paciente-google@gauth-test.com",
      });

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(res.status, 403);
      assert.ok(res.body.error.includes("profesionales"));
    });

    it("JWT from Google login works with /auth/me", async () => {
      mockPayload = buildGooglePayload();
      mockShouldThrow = false;

      const loginRes = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      const token = loginRes.body.token;

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(meRes.status, 200);
      assert.equal(meRes.body.user.email, "google-pro@gauth-test.com");
      assert.equal(meRes.body.user.role, "professional");
    });

    it("rejects inactive Google user", async () => {
      await db("users").insert({
        role: "professional",
        name: "Inactiva",
        email: "inactiva-google@gauth-test.com",
        google_id: "google-sub-inactive",
        is_active: false,
      });

      mockPayload = buildGooglePayload({
        sub: "google-sub-inactive",
        email: "inactiva-google@gauth-test.com",
      });

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(res.status, 401);
      assert.ok(res.body.error.includes("desactivada"));
    });

    it("password_hash is never returned in Google response", async () => {
      mockPayload = buildGooglePayload();
      mockShouldThrow = false;

      const res = await request(app)
        .post("/api/auth/google")
        .send({ credential: "valid-google-token" });

      assert.equal(JSON.stringify(res.body).includes("password_hash"), false);
      assert.equal(JSON.stringify(res.body).includes("google_id"), false);
    });
  });

  describe("Existing auth still works", () => {
    it("email/password register still works", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: "Dr. Traditional",
        email: "traditional@gauth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.role, "professional");
    });

    it("email/password login still works", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: "traditional@gauth-test.com",
        password: "segura123",
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
    });
  });
});
