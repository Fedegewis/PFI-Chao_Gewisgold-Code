// Contraseña de pacientes:
//   A) PUT /api/patients/:id/password — la fija el profesional dueño.
//   B) GET/PUT /api/patient/password  — la crea/cambia el propio paciente
//      autenticado (sesión por enlace con CSRF, o JWT).
// Caso que motivó el cambio: paciente que entró por enlace con un correo al
// que no tiene acceso y, al salir, no puede volver a ingresar.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@patient-password-test.com";
const OLD_PASSWORD = "clave-vieja-123";
const NEW_PASSWORD = "clave-nueva-456";
const COOKIE_NAME = "ma_patient_session";

const savedEnabled = process.env.PATIENT_PASSWORDLESS_ENABLED;

function makeEmailDouble() {
  const sent = [];
  return {
    sent,
    isConfigured: () => true,
    async sendPatientLoginLinkEmail(payload) {
      sent.push(payload);
      return { id: `msg-${sent.length}` };
    },
    async sendInvitationEmail() {
      return { id: "inv" };
    },
  };
}

let emailDouble;
let tasks = [];

async function loginByLink(email) {
  await request(app).post("/api/auth/patient-link/request").send({ email }).expect(202);
  await Promise.all(tasks);
  tasks = [];
  const url = emailDouble.sent.at(-1).loginUrl;
  const token = /#\/enlace\/([A-Za-z0-9_-]{43})$/.exec(url)[1];
  const consumed = await request(app).post("/api/auth/patient-link/consume").send({ token }).expect(200);
  const line = consumed.headers["set-cookie"].find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return { cookie: line.split(";")[0], csrf: consumed.body.csrf_token };
}

async function cleanTestData() {
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
  await db("auth_rate_limits").del();
}

describe("Contraseña de pacientes (A: profesional, B: paciente)", () => {
  const stamp = Date.now();
  const mail = (n) => `${n}-${stamp}${EMAIL_SUFFIX}`;
  let prof;
  let otherProf;
  let profAuth;
  let otherProfAuth;
  let linkOnly; // sin contraseña, entra por enlace (correo inaccesible)
  let withPassword;

  before(async () => {
    await cleanTestData();
    [prof] = await db("users").insert({ role: "professional", name: "Prof", email: mail("prof") }).returning("*");
    [otherProf] = await db("users").insert({ role: "professional", name: "Otro", email: mail("otro") }).returning("*");
    profAuth = authHeaderFor(prof);
    otherProfAuth = authHeaderFor(otherProf);
  });

  beforeEach(async () => {
    process.env.PATIENT_PASSWORDLESS_ENABLED = "true";
    emailDouble = makeEmailDouble();
    tasks = [];
    app.locals.emailService = emailDouble;
    app.locals.onPasswordlessTask = (t) => tasks.push(t);
    await db("users").where("email", "like", `p-%${EMAIL_SUFFIX}`).del();
    await db("auth_rate_limits").del();
    [linkOnly] = await db("users")
      .insert({ role: "patient", name: "Carla", email: mail("p-carla"), professional_id: prof.id, allow_passwordless: true })
      .returning("*");
    [withPassword] = await db("users")
      .insert({
        role: "patient",
        name: "Ana",
        email: mail("p-ana"),
        professional_id: prof.id,
        allow_passwordless: true,
        password_hash: await bcrypt.hash(OLD_PASSWORD, 4),
      })
      .returning("*");
  });

  afterEach(async () => {
    await Promise.all(tasks);
    delete app.locals.emailService;
    delete app.locals.onPasswordlessTask;
  });

  after(async () => {
    if (savedEnabled === undefined) delete process.env.PATIENT_PASSWORDLESS_ENABLED;
    else process.env.PATIENT_PASSWORDLESS_ENABLED = savedEnabled;
    await cleanTestData();
    await db.destroy();
  });

  describe("A — PUT /api/patients/:id/password (profesional dueño)", () => {
    it("crea la contraseña de un paciente sin contraseña y permite el login", async () => {
      const res = await request(app)
        .put(`/api/patients/${linkOnly.id}/password`)
        .set("Authorization", profAuth)
        .send({ password: NEW_PASSWORD })
        .expect(200);
      assert.equal(res.body.has_password, true);
      assert.equal(res.body.password_action, "created");
      assert.equal(res.body.allow_passwordless, true, "no toca el permiso de enlace");
      assert.equal(JSON.stringify(res.body).includes(NEW_PASSWORD), false);
      assert.equal("password_hash" in res.body, false);

      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: linkOnly.email, password: NEW_PASSWORD })
        .expect(200);
      assert.equal(login.body.user.id, linkOnly.id);
    });

    it("reemplaza una contraseña existente (la anterior deja de valer)", async () => {
      const res = await request(app)
        .put(`/api/patients/${withPassword.id}/password`)
        .set("Authorization", profAuth)
        .send({ password: NEW_PASSWORD })
        .expect(200);
      assert.equal(res.body.password_action, "replaced");
      await request(app).post("/api/auth/login").send({ email: withPassword.email, password: OLD_PASSWORD }).expect(401);
      await request(app).post("/api/auth/login").send({ email: withPassword.email, password: NEW_PASSWORD }).expect(200);
    });

    it("no cierra las sesiones abiertas con enlace", async () => {
      const { cookie } = await loginByLink(linkOnly.email);
      await request(app)
        .put(`/api/patients/${linkOnly.id}/password`)
        .set("Authorization", profAuth)
        .send({ password: NEW_PASSWORD })
        .expect(200);
      await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    });

    it("un profesional ajeno recibe 404 y no cambia nada", async () => {
      await request(app)
        .put(`/api/patients/${linkOnly.id}/password`)
        .set("Authorization", otherProfAuth)
        .send({ password: NEW_PASSWORD })
        .expect(404);
      const row = await db("users").where({ id: linkOnly.id }).first();
      assert.equal(row.password_hash, null);
    });

    it("un paciente no puede usarlo (403) y sin token es 401", async () => {
      await request(app)
        .put(`/api/patients/${linkOnly.id}/password`)
        .set("Authorization", authHeaderFor(withPassword))
        .send({ password: NEW_PASSWORD })
        .expect(403);
      await request(app).put(`/api/patients/${linkOnly.id}/password`).send({ password: NEW_PASSWORD }).expect(401);
    });

    it("id inválido o de un profesional recibe 404", async () => {
      await request(app).put("/api/patients/abc/password").set("Authorization", profAuth).send({ password: NEW_PASSWORD }).expect(404);
      await request(app).put(`/api/patients/${prof.id}/password`).set("Authorization", profAuth).send({ password: NEW_PASSWORD }).expect(404);
    });

    for (const [label, payload] of [
      ["corta", { password: "12345" }],
      ["vacía", { password: "" }],
      ["ausente", {}],
      ["no string", { password: 123456 }],
      ["más de 72 bytes", { password: "x".repeat(73) }],
      ["campos extra", { password: NEW_PASSWORD, role: "professional" }],
    ]) {
      it(`rechaza contraseña ${label} (400) sin modificar`, async () => {
        await request(app)
          .put(`/api/patients/${linkOnly.id}/password`)
          .set("Authorization", profAuth)
          .send(payload)
          .expect(400);
        const row = await db("users").where({ id: linkOnly.id }).first();
        assert.equal(row.password_hash, null);
      });
    }

    it("GET /access refleja has_password después de crearla (habilita desactivar el enlace)", async () => {
      await request(app).put(`/api/patients/${linkOnly.id}/password`).set("Authorization", profAuth).send({ password: NEW_PASSWORD });
      const access = await request(app).get(`/api/patients/${linkOnly.id}/access`).set("Authorization", profAuth).expect(200);
      assert.equal(access.body.has_password, true);
      await request(app)
        .patch(`/api/patients/${linkOnly.id}/access`)
        .set("Authorization", profAuth)
        .send({ allow_passwordless: false, confirm_revoke_sessions: true })
        .expect(200);
    });
  });

  describe("B — /api/patient/password (paciente autenticado)", () => {
    it("con sesión por enlace: informa que no tiene contraseña y la crea", async () => {
      const { cookie, csrf } = await loginByLink(linkOnly.email);
      const status = await request(app).get("/api/patient/password").set("Cookie", cookie).expect(200);
      assert.deepEqual(status.body, { has_password: false });

      const res = await request(app)
        .put("/api/patient/password")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({ password: NEW_PASSWORD })
        .expect(200);
      assert.deepEqual(res.body, { has_password: true, password_action: "created" });

      await request(app).post("/api/auth/login").send({ email: linkOnly.email, password: NEW_PASSWORD }).expect(200);
      // La sesión por enlace sigue abierta.
      await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    });

    it("con cookie pero sin CSRF válido recibe 403 y no cambia nada", async () => {
      const { cookie } = await loginByLink(linkOnly.email);
      await request(app).put("/api/patient/password").set("Cookie", cookie).send({ password: NEW_PASSWORD }).expect(403);
      await request(app)
        .put("/api/patient/password")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", "x".repeat(43))
        .send({ password: NEW_PASSWORD })
        .expect(403);
      const row = await db("users").where({ id: linkOnly.id }).first();
      assert.equal(row.password_hash, null);
    });

    it("para cambiar una contraseña existente exige la actual", async () => {
      const auth = authHeaderFor(withPassword);
      const missing = await request(app).put("/api/patient/password").set("Authorization", auth).send({ password: NEW_PASSWORD }).expect(400);
      assert.equal(missing.body.status, "current_password_required");

      const wrong = await request(app)
        .put("/api/patient/password")
        .set("Authorization", auth)
        .send({ password: NEW_PASSWORD, current_password: "incorrecta" })
        .expect(403);
      assert.equal(wrong.body.status, "current_password_invalid");
      await request(app).post("/api/auth/login").send({ email: withPassword.email, password: OLD_PASSWORD }).expect(200);

      const ok = await request(app)
        .put("/api/patient/password")
        .set("Authorization", auth)
        .send({ password: NEW_PASSWORD, current_password: OLD_PASSWORD })
        .expect(200);
      assert.equal(ok.body.password_action, "replaced");
      await request(app).post("/api/auth/login").send({ email: withPassword.email, password: NEW_PASSWORD }).expect(200);
    });

    it("limita los intentos con contraseña actual incorrecta (429)", async () => {
      const auth = authHeaderFor(withPassword);
      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .put("/api/patient/password")
          .set("Authorization", auth)
          .send({ password: NEW_PASSWORD, current_password: "incorrecta" })
          .expect(403);
      }
      await request(app)
        .put("/api/patient/password")
        .set("Authorization", auth)
        .send({ password: NEW_PASSWORD, current_password: OLD_PASSWORD })
        .expect(429);
    });

    it("rechaza contraseña inválida y campos extra (400)", async () => {
      const { cookie, csrf } = await loginByLink(linkOnly.email);
      for (const payload of [{ password: "123" }, {}, { password: NEW_PASSWORD, email: "otro@x.com" }]) {
        await request(app).put("/api/patient/password").set("Cookie", cookie).set("X-CSRF-Token", csrf).send(payload).expect(400);
      }
    });

    it("un profesional no puede usarlo (403) y sin sesión es 401", async () => {
      await request(app).get("/api/patient/password").set("Authorization", profAuth).expect(403);
      await request(app).put("/api/patient/password").set("Authorization", profAuth).send({ password: NEW_PASSWORD }).expect(403);
      await request(app).get("/api/patient/password").expect(401);
      await request(app).put("/api/patient/password").send({ password: NEW_PASSWORD }).expect(401);
    });
  });

  it("no existe un endpoint público para fijar contraseña desde un email", async () => {
    for (const path of ["/api/auth/set-password", "/api/auth/patient-password", "/api/patient/password"]) {
      const res = await request(app).put(path).send({ email: linkOnly.email, password: NEW_PASSWORD });
      assert.notEqual(res.status, 200);
    }
    const row = await db("users").where({ id: linkOnly.id }).first();
    assert.equal(row.password_hash, null);
  });
});
