// 6F: cobertura del endpoint POST /api/invitations/:id/send-email.
// El emailService se inyecta como mock vía app.locals — nunca se llama a Resend real.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@invemail-test.com";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function cleanTestData() {
  await db("patient_invitations").where("email", "like", `%${EMAIL_SUFFIX}`).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function createPendingInvitation({ professionalId, email, patientName = "Paciente Email" }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  const [row] = await db("patient_invitations")
    .insert({
      professional_id: professionalId,
      email,
      patient_name: patientName,
      age: 70,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .returning("*");
  return { invitation: row, token };
}

describe("Invitations email API (6F)", () => {
  let profA;
  let profB;
  let profAAuth;
  let patient;
  let patientAuth;
  let sendCalls;

  before(async () => {
    await cleanTestData();
    [profA] = await db("users")
      .insert({ role: "professional", name: "Dra. Email A", email: `prof-a-${Date.now()}${EMAIL_SUFFIX}` })
      .returning("*");
    [profB] = await db("users")
      .insert({ role: "professional", name: "Dra. Email B", email: `prof-b-${Date.now()}${EMAIL_SUFFIX}` })
      .returning("*");
    [patient] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente Email",
        email: `existing-${Date.now()}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
      })
      .returning("*");
    profAAuth = authHeaderFor(profA);
    patientAuth = authHeaderFor(patient);
  });

  afterEach(() => {
    sendCalls = [];
    delete app.locals.emailService;
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  function installMockEmailService({ configured = true, throws = null } = {}) {
    sendCalls = [];
    app.locals.emailService = {
      isConfigured: () => configured,
      sendInvitationEmail: async (payload) => {
        sendCalls.push(payload);
        if (throws) {
          const err = new Error(throws.message || "provider fail");
          if (throws.code) err.code = throws.code;
          throw err;
        }
        return { id: "msg_test_123" };
      },
    };
  }

  it("professional owner can send email for pending invitation", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `to-1-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 200);
    assert.equal(res.body.sent, true);
    assert.equal(res.body.message_id, "msg_test_123");
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.token_hash, undefined);
    assert.equal(sendCalls.length, 1);
    // Recipient siempre desde DB.
    assert.equal(sendCalls[0].to, invitation.email);
    assert.equal(sendCalls[0].patientName, invitation.patient_name);
    assert.equal(sendCalls[0].professionalName, profA.name);
    // URL construida server-side con FRONTEND_URL + token.
    assert.ok(sendCalls[0].inviteUrl.endsWith(`/#/invite/${token}`));
    assert.ok(sendCalls[0].inviteUrl.startsWith("http"));
  });

  it("recipient ALWAYS comes from DB, never from body", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `db-recipient-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({
        token,
        to: `attacker-${Date.now()}${EMAIL_SUFFIX}`,
        patientName: "Attacker",
        professionalName: "Attacker",
      });
    assert.equal(res.status, 200);
    assert.equal(sendCalls[0].to, invitation.email);
    assert.equal(sendCalls[0].patientName, invitation.patient_name);
    assert.equal(sendCalls[0].professionalName, profA.name);
  });

  it("professional A cannot send email for invitation of B (404)", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profB.id,
      email: `foreign-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 404);
    assert.equal(sendCalls.length, 0);
  });

  it("patient token cannot send emails (403)", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `by-patient-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", patientAuth)
      .send({ token });
    assert.equal(res.status, 403);
    assert.equal(sendCalls.length, 0);
  });

  it("returns 401 without auth", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `noauth-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .send({ token });
    assert.equal(res.status, 401);
    assert.equal(sendCalls.length, 0);
  });

  it("returns 400 invalid_token when the plaintext token does not match", async () => {
    installMockEmailService();
    const { invitation } = await createPendingInvitation({
      professionalId: profA.id,
      email: `badtoken-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token: "wrong-token-value" });
    assert.equal(res.status, 400);
    assert.equal(res.body.status, "invalid_token");
    assert.equal(sendCalls.length, 0);
  });

  it("returns 400 invalid_token when token is missing", async () => {
    installMockEmailService();
    const { invitation } = await createPendingInvitation({
      professionalId: profA.id,
      email: `notoken-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.status, "invalid_token");
  });

  it("returns 410 expired for expired invitations", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `expired-${Date.now()}${EMAIL_SUFFIX}`,
    });
    await db("patient_invitations").where({ id: invitation.id }).update({
      expires_at: new Date(Date.now() - 3600 * 1000),
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 410);
    assert.equal(res.body.status, "expired");
    assert.equal(sendCalls.length, 0);
  });

  it("returns 410 revoked for revoked invitations", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `revoked-${Date.now()}${EMAIL_SUFFIX}`,
    });
    await db("patient_invitations").where({ id: invitation.id }).update({ revoked_at: db.fn.now() });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 410);
    assert.equal(res.body.status, "revoked");
    assert.equal(sendCalls.length, 0);
  });

  it("returns 409 accepted for already accepted invitations", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `accepted-${Date.now()}${EMAIL_SUFFIX}`,
    });
    await db("patient_invitations").where({ id: invitation.id }).update({ accepted_at: db.fn.now() });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 409);
    assert.equal(res.body.status, "accepted");
    assert.equal(sendCalls.length, 0);
  });

  it("returns 503 email_not_configured when the service is not configured", async () => {
    installMockEmailService({ configured: false });
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `noconf-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "email_not_configured");
    assert.equal(sendCalls.length, 0);
  });

  it("returns 502 when provider throws (no internal details leaked)", async () => {
    installMockEmailService({ throws: { message: "Resend upstream is down", code: "email_provider_error" } });
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `providerfail-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    assert.equal(res.status, 502);
    assert.equal(res.body.status, "email_provider_error");
    // No filtramos el mensaje interno del provider.
    assert.ok(!res.body.error.includes("Resend upstream"));
    assert.equal(res.body.provider_error, undefined);
    assert.equal(res.body.stack, undefined);
  });

  it("returns 404 for non-existent invitation id", async () => {
    installMockEmailService();
    const res = await request(app)
      .post("/api/invitations/999999/send-email")
      .set("Authorization", profAAuth)
      .send({ token: "whatever" });
    assert.equal(res.status, 404);
  });

  it("6F guard-rail: production without FRONTEND_URL returns 503 frontend_url_not_configured", async () => {
    installMockEmailService();
    const originalFrontend = process.env.FRONTEND_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.FRONTEND_URL;
    process.env.NODE_ENV = "production";
    try {
      const { invitation, token } = await createPendingInvitation({
        professionalId: profA.id,
        email: `noFrontend-${Date.now()}${EMAIL_SUFFIX}`,
      });
      const res = await request(app)
        .post(`/api/invitations/${invitation.id}/send-email`)
        .set("Authorization", profAAuth)
        .send({ token });
      assert.equal(res.status, 503);
      assert.equal(res.body.status, "frontend_url_not_configured");
      assert.equal(sendCalls.length, 0);
    } finally {
      if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontend;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("6F guard-rail: development without FRONTEND_URL uses localhost fallback", async () => {
    installMockEmailService();
    const originalFrontend = process.env.FRONTEND_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.FRONTEND_URL;
    process.env.NODE_ENV = "development";
    try {
      const { invitation, token } = await createPendingInvitation({
        professionalId: profA.id,
        email: `devFallback-${Date.now()}${EMAIL_SUFFIX}`,
      });
      const res = await request(app)
        .post(`/api/invitations/${invitation.id}/send-email`)
        .set("Authorization", profAAuth)
        .send({ token });
      assert.equal(res.status, 200);
      assert.equal(sendCalls.length, 1);
      assert.equal(sendCalls[0].inviteUrl, `http://localhost:5179/#/invite/${token}`);
    } finally {
      if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontend;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("URL uses FRONTEND_URL + token; trailing slash normalized", async () => {
    installMockEmailService();
    const originalFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "http://example.test/";
    try {
      const { invitation, token } = await createPendingInvitation({
        professionalId: profA.id,
        email: `url-${Date.now()}${EMAIL_SUFFIX}`,
      });
      const res = await request(app)
        .post(`/api/invitations/${invitation.id}/send-email`)
        .set("Authorization", profAAuth)
        .send({ token });
      assert.equal(res.status, 200);
      assert.equal(sendCalls[0].inviteUrl, `http://example.test/#/invite/${token}`);
    } finally {
      if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontend;
    }
  });

  it("send-email response never contains token_hash or api key", async () => {
    installMockEmailService();
    const { invitation, token } = await createPendingInvitation({
      professionalId: profA.id,
      email: `noleak-${Date.now()}${EMAIL_SUFFIX}`,
    });
    const res = await request(app)
      .post(`/api/invitations/${invitation.id}/send-email`)
      .set("Authorization", profAAuth)
      .send({ token });
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("RESEND_API_KEY"));
    assert.ok(!serialized.includes(hashToken(token)));
  });
});
