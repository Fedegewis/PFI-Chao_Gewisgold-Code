import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@patients-test.com";

async function cleanTestData() {
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Patients API", () => {
  let profA;
  let profB;
  let profAAuth;
  let profBAuth;
  let profNew;
  let profNewAuth;
  let profAPatient1;
  let profAPatient2;
  let profBPatient1;
  let patientAuth;

  before(async () => {
    await cleanTestData();

    [profA] = await db("users")
      .insert({
        role: "professional",
        name: "Prof A",
        email: `prof-a-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");
    [profB] = await db("users")
      .insert({
        role: "professional",
        name: "Prof B",
        email: `prof-b-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");
    [profNew] = await db("users")
      .insert({
        role: "professional",
        name: "Prof New",
        email: `prof-new-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");

    profAAuth = authHeaderFor(profA);
    profBAuth = authHeaderFor(profB);
    profNewAuth = authHeaderFor(profNew);

    [profAPatient1] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente A1",
        email: `a1-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
      })
      .returning("*");
    [profAPatient2] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente A2",
        email: `a2-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
      })
      .returning("*");
    [profBPatient1] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente B1",
        email: `b1-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profB.id,
      })
      .returning("*");

    patientAuth = authHeaderFor(profAPatient1);
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("GET /api/patients", () => {
    it("returns only patients owned by the authenticated professional", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", profAAuth);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      const ids = res.body.map((p) => p.id).sort();
      assert.deepEqual(ids, [profAPatient1.id, profAPatient2.id].sort());
      for (const p of res.body) {
        assert.equal(p.role, "patient");
        assert.equal(p.professional_id, profA.id);
      }
    });

    it("does not leak patients from another professional", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", profBAuth);
      assert.equal(res.status, 200);
      const ids = res.body.map((p) => p.id);
      assert.ok(!ids.includes(profAPatient1.id));
      assert.ok(!ids.includes(profAPatient2.id));
      assert.deepEqual(ids, [profBPatient1.id]);
    });

    it("returns [] for a professional with no patients", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", profNewAuth);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, []);
    });

    it("rejects requests without a token", async () => {
      const res = await request(app).get("/api/patients");
      assert.equal(res.status, 401);
    });

    it("rejects requests from a patient token", async () => {
      const res = await request(app)
        .get("/api/patients")
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
    });

    it("ignores a professional_id query/body attempt to impersonate", async () => {
      const res = await request(app)
        .get(`/api/patients?professional_id=${profA.id}`)
        .set("Authorization", profBAuth);
      assert.equal(res.status, 200);
      const ids = res.body.map((p) => p.id);
      assert.ok(!ids.includes(profAPatient1.id));
    });
  });

  describe("POST /api/users (create patient)", () => {
    it("takes professional_id exclusively from the JWT", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", profBAuth)
        .send({
          name: "Nuevo B",
          email: `nuevo-b-${Date.now()}${EMAIL_SUFFIX}`,
          age: 70,
          professional_id: profA.id,
          role: "professional",
        });
      assert.equal(res.status, 201);
      assert.equal(res.body.role, "patient");
      assert.equal(res.body.professional_id, profB.id);
    });

    it("rejects patient tokens", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", patientAuth)
        .send({
          name: "Bloqueado",
          email: `blocked-${Date.now()}${EMAIL_SUFFIX}`,
        });
      assert.equal(res.status, 403);
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).post("/api/users").send({
        name: "Sin token",
        email: `no-token-${Date.now()}${EMAIL_SUFFIX}`,
      });
      assert.equal(res.status, 401);
    });
  });
});
