import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@invitations-test.com";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function cleanTestData() {
  await db("patient_invitations")
    .where("email", "like", `%${EMAIL_SUFFIX}`)
    .del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Invitations API", () => {
  let profA;
  let profB;
  let profAAuth;
  let profBAuth;
  let patientUser;
  let patientAuth;

  before(async () => {
    await cleanTestData();

    [profA] = await db("users")
      .insert({
        role: "professional",
        name: "Prof Inv A",
        email: `prof-a-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");
    [profB] = await db("users")
      .insert({
        role: "professional",
        name: "Prof Inv B",
        email: `prof-b-${Date.now()}${EMAIL_SUFFIX}`,
      })
      .returning("*");
    [patientUser] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente Existente",
        email: `existing-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
      })
      .returning("*");

    profAAuth = authHeaderFor(profA);
    profBAuth = authHeaderFor(profB);
    patientAuth = authHeaderFor(patientUser);
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  function inviteBody(overrides = {}) {
    return {
      name: "Nuevo Paciente",
      age: 70,
      email: `invite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${EMAIL_SUFFIX}`,
      ...overrides,
    };
  }

  describe("POST /api/invitations", () => {
    it("creates an invitation and returns a plaintext token that is NOT stored in the DB", async () => {
      const body = inviteBody();
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(body);

      assert.equal(res.status, 201);
      assert.ok(res.body.token, "response must include the plaintext token");
      assert.equal(typeof res.body.token, "string");
      assert.ok(res.body.token.length >= 32);
      assert.equal(res.body.email, body.email);
      assert.equal(res.body.patient_name, body.name);
      assert.equal(res.body.age, body.age);
      assert.equal(res.body.professional_id, profA.id);
      assert.equal(res.body.status, "pending");
      assert.ok(res.body.expires_at);

      const stored = await db("patient_invitations").where({ id: res.body.id }).first();
      assert.ok(stored);
      assert.equal(stored.token_hash, hashToken(res.body.token));
      assert.notEqual(stored.token_hash, res.body.token);

      const plaintextMatches = await db("patient_invitations")
        .where({ token_hash: res.body.token })
        .first();
      assert.equal(plaintextMatches, undefined, "plaintext token must not exist in DB");
    });

    it("takes professional_id exclusively from the JWT", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profBAuth)
        .send({ ...inviteBody(), professional_id: profA.id });

      assert.equal(res.status, 201);
      assert.equal(res.body.professional_id, profB.id);
    });

    it("does not expose token_hash in the response", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody());

      assert.equal(res.status, 201);
      assert.equal(res.body.token_hash, undefined);
    });

    it("returns 409 when the email already belongs to a user", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody({ email: patientUser.email }));

      assert.equal(res.status, 409);

      const rows = await db("patient_invitations").where({ email: patientUser.email });
      assert.equal(rows.length, 0, "no invitation should be persisted for existing user");
    });

    it("revokes a previous pending invitation for the same professional/email", async () => {
      const email = `dup-${Date.now()}${EMAIL_SUFFIX}`;

      const first = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody({ email }));
      assert.equal(first.status, 201);

      const second = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody({ email }));
      assert.equal(second.status, 201);
      assert.notEqual(second.body.id, first.body.id);

      const firstRow = await db("patient_invitations").where({ id: first.body.id }).first();
      const secondRow = await db("patient_invitations").where({ id: second.body.id }).first();
      assert.ok(firstRow.revoked_at, "previous invitation must be revoked");
      assert.equal(secondRow.revoked_at, null);
      assert.equal(secondRow.accepted_at, null);
    });

    it("allows a different professional to invite the same email independently", async () => {
      const email = `cross-${Date.now()}${EMAIL_SUFFIX}`;

      const a = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody({ email }));
      assert.equal(a.status, 201);

      const b = await request(app)
        .post("/api/invitations")
        .set("Authorization", profBAuth)
        .send(inviteBody({ email }));
      assert.equal(b.status, 201);

      const aRow = await db("patient_invitations").where({ id: a.body.id }).first();
      const bRow = await db("patient_invitations").where({ id: b.body.id }).first();
      assert.equal(aRow.revoked_at, null, "A's invitation must remain active");
      assert.equal(bRow.revoked_at, null, "B's invitation must remain active");
      assert.notEqual(aRow.professional_id, bRow.professional_id);
    });

    it("rejects invalid email", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody({ email: "not-an-email" }));
      assert.equal(res.status, 400);
    });

    it("rejects invalid age", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody({ age: 300 }));
      assert.equal(res.status, 400);
    });

    it("rejects missing name", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send({ email: `noname-${Date.now()}${EMAIL_SUFFIX}` });
      assert.equal(res.status, 400);
    });

    it("rejects patient tokens", async () => {
      const res = await request(app)
        .post("/api/invitations")
        .set("Authorization", patientAuth)
        .send(inviteBody());
      assert.equal(res.status, 403);
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).post("/api/invitations").send(inviteBody());
      assert.equal(res.status, 401);
    });
  });

  describe("GET /api/invitations", () => {
    it("returns only invitations owned by the authenticated professional and never token_hash", async () => {
      const created = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody());
      assert.equal(created.status, 201);

      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", profAAuth);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      const ids = res.body.map((r) => r.id);
      assert.ok(ids.includes(created.body.id));
      for (const row of res.body) {
        assert.equal(row.professional_id, profA.id);
        assert.equal(row.token_hash, undefined);
        assert.equal(row.token, undefined);
        assert.ok(["pending", "expired", "accepted", "revoked"].includes(row.status));
      }
    });

    it("does not leak invitations from another professional", async () => {
      const bOwn = await request(app)
        .post("/api/invitations")
        .set("Authorization", profBAuth)
        .send(inviteBody());
      assert.equal(bOwn.status, 201);

      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", profAAuth);

      const ids = res.body.map((r) => r.id);
      assert.ok(!ids.includes(bOwn.body.id));
    });

    it("derives status expired from expires_at", async () => {
      const created = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody());
      assert.equal(created.status, 201);

      await db("patient_invitations")
        .where({ id: created.body.id })
        .update({ expires_at: new Date(Date.now() - 1000) });

      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", profAAuth);

      const row = res.body.find((r) => r.id === created.body.id);
      assert.ok(row);
      assert.equal(row.status, "expired");
    });

    it("rejects patient tokens", async () => {
      const res = await request(app)
        .get("/api/invitations")
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).get("/api/invitations");
      assert.equal(res.status, 401);
    });
  });

  describe("DELETE /api/invitations/:id", () => {
    it("soft-revokes the professional's own invitation", async () => {
      const created = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody());
      assert.equal(created.status, 201);

      const res = await request(app)
        .delete(`/api/invitations/${created.body.id}`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "revoked");

      const row = await db("patient_invitations").where({ id: created.body.id }).first();
      assert.ok(row, "row must still exist (soft delete)");
      assert.ok(row.revoked_at);
    });

    it("does not allow professional A to revoke professional B's invitation", async () => {
      const bOwn = await request(app)
        .post("/api/invitations")
        .set("Authorization", profBAuth)
        .send(inviteBody());
      assert.equal(bOwn.status, 201);

      const res = await request(app)
        .delete(`/api/invitations/${bOwn.body.id}`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 404);

      const row = await db("patient_invitations").where({ id: bOwn.body.id }).first();
      assert.equal(row.revoked_at, null);
    });

    it("returns 404 for a non-existent invitation", async () => {
      const res = await request(app)
        .delete("/api/invitations/9999999")
        .set("Authorization", profAAuth);
      assert.equal(res.status, 404);
    });

    it("returns 404 for an invalid id", async () => {
      const res = await request(app)
        .delete("/api/invitations/not-a-number")
        .set("Authorization", profAAuth);
      assert.equal(res.status, 404);
    });

    it("does not affect a user already created from an accepted invitation", async () => {
      const created = await request(app)
        .post("/api/invitations")
        .set("Authorization", profAAuth)
        .send(inviteBody());
      assert.equal(created.status, 201);

      const [acceptedUser] = await db("users")
        .insert({
          role: "patient",
          name: "Aceptado",
          email: `accepted-${Date.now()}${EMAIL_SUFFIX}`,
          professional_id: profA.id,
        })
        .returning("*");

      await db("patient_invitations").where({ id: created.body.id }).update({
        accepted_at: new Date(),
        accepted_user_id: acceptedUser.id,
      });

      const res = await request(app)
        .delete(`/api/invitations/${created.body.id}`)
        .set("Authorization", profAAuth);
      assert.equal(res.status, 200);

      const invRow = await db("patient_invitations").where({ id: created.body.id }).first();
      assert.ok(invRow.accepted_at);
      assert.equal(invRow.revoked_at, null, "already-accepted invitations are not revoked");

      const userStillThere = await db("users").where({ id: acceptedUser.id }).first();
      assert.ok(userStillThere, "the accepted user must not be affected");
    });

    it("rejects patient tokens", async () => {
      const res = await request(app)
        .delete("/api/invitations/1")
        .set("Authorization", patientAuth);
      assert.equal(res.status, 403);
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).delete("/api/invitations/1");
      assert.equal(res.status, 401);
    });
  });
});
