// Aceptar una invitación SIN contraseña: el paciente entra directo con una
// sesión persistente por cookie (F3) y queda habilitado para volver a entrar
// pidiendo un enlace a su correo (F2). El modo con contraseña no cambia.
//
// No se envían correos reales: app.locals.emailService es un doble.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import { hashToken } from "../src/services/patientPasswordless.js";

const EMAIL_SUFFIX = "@invite-passwordless-test.com";
const COOKIE_NAME = "ma_patient_session"; // NODE_ENV=test → sin Secure ni __Host-
const savedFlag = process.env.PATIENT_PASSWORDLESS_ENABLED;

function emailDouble({ configured = true } = {}) {
  return {
    isConfigured: () => configured,
    async sendInvitationEmail() { return { id: "inv" }; },
    async sendPatientLoginLinkEmail() { return { id: "link" }; },
  };
}

function sessionCookieFrom(res) {
  const line = (res.headers["set-cookie"] || []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return line ? line.split(";")[0].slice(COOKIE_NAME.length + 1) : null;
}

async function cleanTestData() {
  await db("patient_invitations").where("email", "like", `%${EMAIL_SUFFIX}`).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Invitación aceptada sin contraseña", () => {
  let prof;
  let profAuth;

  async function createInvite() {
    const res = await request(app)
      .post("/api/invitations")
      .set("Authorization", profAuth)
      .send({ name: "Elsa Sin Clave", age: 74, email: `elsa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${EMAIL_SUFFIX}` });
    assert.equal(res.status, 201);
    return res.body;
  }

  before(async () => {
    await cleanTestData();
    [prof] = await db("users")
      .insert({ role: "professional", name: "Prof Invita", email: `prof-${Date.now()}${EMAIL_SUFFIX}` })
      .returning("*");
    profAuth = authHeaderFor(prof);
  });

  beforeEach(() => {
    process.env.PATIENT_PASSWORDLESS_ENABLED = "true";
    app.locals.emailService = emailDouble();
  });

  afterEach(() => {
    delete app.locals.emailService;
  });

  after(async () => {
    if (savedFlag === undefined) delete process.env.PATIENT_PASSWORDLESS_ENABLED;
    else process.env.PATIENT_PASSWORDLESS_ENABLED = savedFlag;
    await cleanTestData();
    await db.destroy();
  });

  it("lookup informa si el ingreso sin contraseña está disponible", async () => {
    const inv = await createInvite();
    const on = await request(app).get("/api/invitations/lookup").query({ token: inv.token });
    assert.equal(on.status, 200);
    assert.equal(on.body.passwordless_available, true);

    process.env.PATIENT_PASSWORDLESS_ENABLED = "false";
    const off = await request(app).get("/api/invitations/lookup").query({ token: inv.token });
    assert.equal(off.body.passwordless_available, false);

    process.env.PATIENT_PASSWORDLESS_ENABLED = "true";
    app.locals.emailService = emailDouble({ configured: false });
    const noEmail = await request(app).get("/api/invitations/lookup").query({ token: inv.token });
    assert.equal(noEmail.body.passwordless_available, false);
  });

  it("crea al paciente sin contraseña, habilitado por enlace, y abre una sesión por cookie", async () => {
    const inv = await createInvite();
    const res = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: true });
    assert.equal(res.status, 201);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.user.role, "patient");
    assert.equal(res.body.user.email, inv.email);
    assert.equal(res.body.auth_method, "patient_session");
    assert.ok(res.body.csrf_token);
    assert.equal(res.body.token, undefined, "no emite JWT");

    const cookie = sessionCookieFrom(res);
    assert.ok(cookie, "Set-Cookie de sesión");
    const line = res.headers["set-cookie"].find((c) => c.startsWith(`${COOKIE_NAME}=`));
    assert.match(line, /HttpOnly/);
    assert.match(line, /SameSite=Strict/);

    const user = await db("users").where({ id: res.body.user.id }).first();
    assert.equal(user.password_hash, null);
    assert.equal(user.allow_passwordless, true);
    assert.equal(user.professional_id, prof.id);
    assert.equal(user.name, "Elsa Sin Clave");
    assert.equal(user.age, 74);

    const session = await db("patient_auth_sessions").where({ token_hash: hashToken(cookie) }).first();
    assert.equal(session.user_id, user.id);
    assert.equal(session.revoked_at, null);

    const invitation = await db("patient_invitations").where({ id: inv.id }).first();
    assert.ok(invitation.accepted_at);
    assert.equal(invitation.accepted_user_id, user.id);

    // La cookie sirve para restaurar la sesión y para usar la API.
    const restored = await request(app).get("/api/auth/patient-session").set("Cookie", `${COOKIE_NAME}=${cookie}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.user.id, user.id);
    const me = await request(app).get("/api/auth/me").set("Cookie", `${COOKIE_NAME}=${cookie}`);
    assert.equal(me.status, 200);
  });

  it("es de un solo uso: el segundo intento no crea otro usuario ni otra sesión", async () => {
    const inv = await createInvite();
    const first = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: true });
    assert.equal(first.status, 201);
    const second = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: true });
    assert.equal(second.status, 409);
    assert.equal(second.body.status, "accepted");
    assert.equal(sessionCookieFrom(second), null);
    const sessions = await db("patient_auth_sessions").where({ user_id: first.body.user.id });
    assert.equal(sessions.length, 1);
  });

  it("con el flujo apagado responde 503 y no consume la invitación", async () => {
    const inv = await createInvite();
    process.env.PATIENT_PASSWORDLESS_ENABLED = "false";
    const res = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: true });
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "passwordless_unavailable");
    const invitation = await db("patient_invitations").where({ id: inv.id }).first();
    assert.equal(invitation.accepted_at, null);
    assert.equal(await db("users").where({ email: inv.email }).first(), undefined);
  });

  it("sin correo configurado responde 503 (el paciente no podría volver a entrar)", async () => {
    const inv = await createInvite();
    app.locals.emailService = emailDouble({ configured: false });
    const res = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: true });
    assert.equal(res.status, 503);
  });

  it("invitaciones vencidas o revocadas se rechazan igual que con contraseña", async () => {
    const expired = await createInvite();
    await db("patient_invitations").where({ id: expired.id }).update({ expires_at: new Date(Date.now() - 1000) });
    const r1 = await request(app).post(`/api/invitations/${expired.token}/accept`).send({ passwordless: true });
    assert.equal(r1.status, 410);
    assert.equal(r1.body.status, "expired");

    const revoked = await createInvite();
    await db("patient_invitations").where({ id: revoked.id }).update({ revoked_at: db.fn.now() });
    const r2 = await request(app).post(`/api/invitations/${revoked.token}/accept`).send({ passwordless: true });
    assert.equal(r2.status, 410);
    assert.equal(r2.body.status, "revoked");
  });

  it("D5: el profesional no puede quitarle el enlace a un paciente sin contraseña", async () => {
    const inv = await createInvite();
    const res = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: true });
    const patch = await request(app)
      .patch(`/api/patients/${res.body.user.id}/access`)
      .set("Authorization", profAuth)
      .send({ allow_passwordless: false, confirm_revoke_sessions: true });
    assert.equal(patch.status, 409);
    assert.equal(patch.body.status, "last_access_method");
  });

  it("passwordless distinto de true sigue exigiendo contraseña", async () => {
    const inv = await createInvite();
    const res = await request(app).post(`/api/invitations/${inv.token}/accept`).send({ passwordless: "true" });
    assert.equal(res.status, 400);
    assert.equal(res.body.status, "invalid_password");
  });
});
