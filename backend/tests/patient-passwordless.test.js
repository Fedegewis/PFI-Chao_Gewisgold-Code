// F2 + F3 — acceso sin contraseña de pacientes (enlace por correo) y
// sesiones persistentes por cookie. Incluye reglas D5 / E2 de F1 y
// regresión de los métodos tradicionales.
//
// No se envían correos reales: app.locals.emailService es un doble en memoria.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";
import {
  LOGIN_LINK_TTL_MS,
  PREVIOUS_TOKEN_GRACE_MS,
  SESSION_TTL_MS,
  csrfTokenForSession,
  hashToken,
} from "../src/services/patientPasswordless.js";

const EMAIL_SUFFIX = "@passwordless-test.com";
const PASSWORD = "clave-de-prueba-123";
const COOKIE_NAME = "ma_patient_session"; // NODE_ENV=test → sin Secure ni __Host-

const ENV_KEYS = [
  "PATIENT_PASSWORDLESS_ENABLED",
  "PASSWORDLESS_EMAIL_LIMIT_15MIN",
  "PASSWORDLESS_EMAIL_LIMIT_DAY",
  "PASSWORDLESS_IP_LIMIT_15MIN",
  "PASSWORDLESS_CONSUME_IP_LIMIT_15MIN",
  "AUTH_COOKIE_SECURE",
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function makeEmailDouble() {
  const sent = [];
  return {
    sent,
    configured: true,
    failNext: false,
    isConfigured() {
      return this.configured;
    },
    async sendPatientLoginLinkEmail(payload) {
      if (this.failNext) {
        this.failNext = false;
        const err = new Error("Email provider error");
        err.code = "email_provider_error";
        throw err;
      }
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

async function flushTasks() {
  const pending = tasks;
  tasks = [];
  return Promise.all(pending);
}

function tokenFromUrl(url) {
  const match = /#\/enlace\/([A-Za-z0-9_-]{43})$/.exec(url);
  assert.ok(match, `URL de enlace inesperada: ${url}`);
  return match[1];
}

function sessionCookieFrom(res) {
  const raw = res.headers["set-cookie"] || [];
  const line = raw.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!line) return null;
  return { line, value: line.split(";")[0].slice(COOKIE_NAME.length + 1) };
}

function cookieHeader(value) {
  return `${COOKIE_NAME}=${value}`;
}

async function requestLink(email, { ip } = {}) {
  const req = request(app).post("/api/auth/patient-link/request");
  if (ip) req.set("X-Forwarded-For", ip);
  const res = await req.send({ email });
  await flushTasks();
  return res;
}

async function loginByLink(email) {
  const before = emailDouble.sent.length;
  const res = await requestLink(email);
  assert.equal(res.status, 202);
  assert.equal(emailDouble.sent.length, before + 1, "se esperaba un correo");
  const token = tokenFromUrl(emailDouble.sent.at(-1).loginUrl);
  const consumed = await request(app).post("/api/auth/patient-link/consume").send({ token });
  assert.equal(consumed.status, 200);
  const cookie = sessionCookieFrom(consumed);
  assert.ok(cookie);
  return { cookie: cookie.value, csrf: consumed.body.csrf_token, body: consumed.body };
}

async function cleanTestData() {
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
  await db("auth_rate_limits").del();
}

describe("Patient passwordless access (F2 + F3)", () => {
  let prof;
  let otherProf;
  let profAuth;
  let otherProfAuth;
  let allowed; // paciente con contraseña y permiso
  let noPermission; // paciente con contraseña, sin permiso
  let linkOnly; // paciente sin contraseña, con permiso (D5)
  let inactive;
  const stamp = Date.now();
  const mail = (name) => `${name}-${stamp}${EMAIL_SUFFIX}`;

  before(async () => {
    await cleanTestData();
    const hash = await bcrypt.hash(PASSWORD, 4);
    [prof] = await db("users").insert({ role: "professional", name: "Prof", email: mail("prof"), password_hash: hash }).returning("*");
    [otherProf] = await db("users").insert({ role: "professional", name: "Otro", email: mail("otro") }).returning("*");
    profAuth = authHeaderFor(prof);
    otherProfAuth = authHeaderFor(otherProf);
    [allowed] = await db("users")
      .insert({ role: "patient", name: "Ana", email: mail("ana"), professional_id: prof.id, password_hash: hash, allow_passwordless: true })
      .returning("*");
    [noPermission] = await db("users")
      .insert({ role: "patient", name: "Beto", email: mail("beto"), professional_id: prof.id, password_hash: hash })
      .returning("*");
    [linkOnly] = await db("users")
      .insert({ role: "patient", name: "Carla", email: mail("carla"), professional_id: prof.id, allow_passwordless: true })
      .returning("*");
    [inactive] = await db("users")
      .insert({ role: "patient", name: "Dora", email: mail("dora"), professional_id: prof.id, password_hash: hash, allow_passwordless: true, is_active: false })
      .returning("*");
  });

  beforeEach(async () => {
    process.env.PATIENT_PASSWORDLESS_ENABLED = "true";
    for (const k of ENV_KEYS.slice(1)) delete process.env[k];
    emailDouble = makeEmailDouble();
    tasks = [];
    app.locals.emailService = emailDouble;
    app.locals.onPasswordlessTask = (task) => tasks.push(task);
    await db("auth_rate_limits").del();
    const ids = [allowed.id, noPermission.id, linkOnly.id, inactive.id];
    await db("patient_auth_sessions").whereIn("user_id", ids).del();
    await db("patient_login_links").whereIn("user_id", ids).del();
    await db("users").whereIn("id", [allowed.id, linkOnly.id]).update({ allow_passwordless: true, is_active: true });
  });

  afterEach(async () => {
    await flushTasks();
    delete app.locals.emailService;
    delete app.locals.onPasswordlessTask;
  });

  after(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await cleanTestData();
    await db.destroy();
  });

  describe("migraciones", () => {
    it("crea las tablas sin tocar pacientes existentes", async () => {
      for (const table of ["patient_login_links", "patient_auth_sessions", "auth_rate_limits"]) {
        assert.equal(await db.schema.hasTable(table), true, table);
      }
      const row = await db("users").where({ id: noPermission.id }).first();
      assert.equal(row.allow_passwordless, false);
      assert.ok(row.password_hash);
    });

    it("la DB rechaza enlaces de más de 30 minutos y sesiones de más de 30 días", async () => {
      const now = new Date();
      await assert.rejects(
        db("patient_login_links").insert({
          user_id: allowed.id,
          token_hash: "a".repeat(64),
          created_at: now,
          expires_at: new Date(now.getTime() + LOGIN_LINK_TTL_MS + 1000),
        }),
        /chk_patient_login_links_ttl/
      );
      await assert.rejects(
        db("patient_auth_sessions").insert({
          user_id: allowed.id,
          token_hash: "b".repeat(64),
          created_at: now,
          expires_at: new Date(now.getTime() + SESSION_TTL_MS + 1000),
        }),
        /chk_patient_auth_sessions_ttl/
      );
    });
  });

  describe("configuración y kill switch", () => {
    it("config informa enabled según flag y proveedor", async () => {
      let res = await request(app).get("/api/auth/passwordless/config");
      assert.deepEqual(res.body, { enabled: true });
      emailDouble.configured = false;
      res = await request(app).get("/api/auth/passwordless/config");
      assert.deepEqual(res.body, { enabled: false });
      emailDouble.configured = true;
      process.env.PATIENT_PASSWORDLESS_ENABLED = "false";
      res = await request(app).get("/api/auth/passwordless/config");
      assert.deepEqual(res.body, { enabled: false });
    });

    it("con el flag apagado: request/consume 503 y la cookie deja de autenticar", async () => {
      const { cookie } = await loginByLink(allowed.email);
      process.env.PATIENT_PASSWORDLESS_ENABLED = "false";
      const req = await request(app).post("/api/auth/patient-link/request").send({ email: allowed.email });
      assert.equal(req.status, 503);
      const cons = await request(app).post("/api/auth/patient-link/consume").send({ token: "x".repeat(43) });
      assert.equal(cons.status, 503);
      const me = await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie));
      assert.equal(me.status, 401);
    });
  });

  describe("solicitud del enlace", () => {
    it("paciente habilitado: 202 genérico, un correo, sólo el hash en la DB", async () => {
      const res = await requestLink(allowed.email.toUpperCase());
      assert.equal(res.status, 202);
      assert.equal(res.body.ok, true);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(emailDouble.sent.length, 1);
      const mailSent = emailDouble.sent[0];
      assert.equal(mailSent.to, allowed.email);
      assert.equal(mailSent.ttlMinutes, 30);
      assert.ok(mailSent.loginUrl.startsWith("http://localhost:5179/#/enlace/"));
      const token = tokenFromUrl(mailSent.loginUrl);
      assert.ok(!JSON.stringify(res.body).includes(token));

      const links = await db("patient_login_links").where({ user_id: allowed.id });
      assert.equal(links.length, 1);
      assert.equal(links[0].token_hash, hashToken(token));
      assert.ok(!JSON.stringify(links[0]).includes(token));
      const ttl = new Date(links[0].expires_at) - new Date(links[0].created_at);
      assert.equal(ttl, LOGIN_LINK_TTL_MS);
    });

    it("email desconocido, sin permiso, inactivo o profesional: misma respuesta y ningún correo", async () => {
      const reference = await requestLink(allowed.email);
      emailDouble.sent.length = 0;
      for (const email of [mail("nadie"), noPermission.email, inactive.email, prof.email]) {
        const res = await requestLink(email);
        assert.equal(res.status, 202, email);
        assert.deepEqual(res.body, reference.body, email);
      }
      assert.equal(emailDouble.sent.length, 0);
      const count = await db("patient_login_links").whereIn("user_id", [noPermission.id, inactive.id, prof.id]).count({ n: "*" }).first();
      assert.equal(Number(count.n), 0);
    });

    it("email inválido → 400", async () => {
      for (const email of [undefined, "", "no-es-email", 42, "a".repeat(250) + "@x.com"]) {
        const res = await request(app).post("/api/auth/patient-link/request").send({ email });
        assert.equal(res.status, 400);
      }
    });

    it("un nuevo pedido invalida el enlace anterior", async () => {
      await requestLink(allowed.email);
      const first = tokenFromUrl(emailDouble.sent[0].loginUrl);
      await requestLink(allowed.email);
      const second = tokenFromUrl(emailDouble.sent[1].loginUrl);
      const old = await request(app).post("/api/auth/patient-link/consume").send({ token: first });
      assert.equal(old.status, 410);
      const ok = await request(app).post("/api/auth/patient-link/consume").send({ token: second });
      assert.equal(ok.status, 200);
    });

    it("rate limit por email: también aplica a emails desconocidos (no enumera)", async () => {
      for (const email of [allowed.email, mail("desconocido")]) {
        for (let i = 0; i < 3; i += 1) {
          assert.equal((await requestLink(email)).status, 202);
        }
        const blocked = await requestLink(email);
        assert.equal(blocked.status, 429);
        assert.equal(blocked.body.status, "rate_limited");
      }
      assert.equal(emailDouble.sent.length, 3);
    });

    it("rate limit por IP (con TRUST_PROXY se usa la IP del cliente)", async () => {
      process.env.PASSWORDLESS_IP_LIMIT_15MIN = "2";
      // Sin trust proxy, X-Forwarded-For se ignora: todo cuenta para la misma IP.
      assert.equal((await requestLink(mail("x1"), { ip: "203.0.113.1" })).status, 202);
      assert.equal((await requestLink(mail("x2"), { ip: "203.0.113.2" })).status, 202);
      assert.equal((await requestLink(mail("x3"), { ip: "203.0.113.3" })).status, 429);

      await db("auth_rate_limits").del();
      app.set("trust proxy", 1);
      try {
        assert.equal((await requestLink(mail("y1"), { ip: "203.0.113.1" })).status, 202);
        assert.equal((await requestLink(mail("y2"), { ip: "203.0.113.1" })).status, 202);
        assert.equal((await requestLink(mail("y3"), { ip: "203.0.113.1" })).status, 429);
        assert.equal((await requestLink(mail("y4"), { ip: "203.0.113.9" })).status, 202);
      } finally {
        app.set("trust proxy", false);
      }
      const stored = await db("auth_rate_limits").select("key_hash");
      assert.ok(stored.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash) && !r.key_hash.includes("203.0.113")));
    });

    it("fallo de Resend: la respuesta sigue siendo genérica y el enlace se invalida", async () => {
      emailDouble.failNext = true;
      const res = await requestLink(allowed.email);
      assert.equal(res.status, 202);
      assert.equal(emailDouble.sent.length, 0);
      const links = await db("patient_login_links").where({ user_id: allowed.id });
      assert.equal(links.length, 1);
      assert.ok(links[0].invalidated_at, "el enlace no enviado debe quedar invalidado");
    });

    it("sin proveedor configurado → 503 sin crear enlaces", async () => {
      emailDouble.configured = false;
      const res = await requestLink(allowed.email);
      assert.equal(res.status, 503);
      assert.equal(await db("patient_login_links").where({ user_id: allowed.id }).first(), undefined);
    });
  });

  describe("consumo del enlace", () => {
    it("crea la sesión y fija una cookie HttpOnly/SameSite=Strict/Path=/ sin Domain, ≤ 30 días", async () => {
      await requestLink(allowed.email);
      const token = tokenFromUrl(emailDouble.sent[0].loginUrl);
      const res = await request(app).post("/api/auth/patient-link/consume").send({ token });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.id, allowed.id);
      assert.equal(res.body.user.role, "patient");
      assert.equal(res.body.auth_method, "patient_session");
      assert.ok(res.body.csrf_token);
      assert.equal(res.body.token, undefined, "no se emite JWT");
      const cookie = sessionCookieFrom(res);
      assert.match(cookie.line, /; HttpOnly/);
      assert.match(cookie.line, /; SameSite=Strict/);
      assert.match(cookie.line, /; Path=\//);
      assert.doesNotMatch(cookie.line, /Domain=/i);
      const maxAge = Number(/Max-Age=(\d+)/.exec(cookie.line)[1]);
      assert.ok(maxAge > SESSION_TTL_MS / 1000 - 60 && maxAge <= SESSION_TTL_MS / 1000);
      assert.ok(!JSON.stringify(res.body).includes(cookie.value));

      const session = await db("patient_auth_sessions").where({ user_id: allowed.id }).first();
      assert.equal(session.token_hash, hashToken(cookie.value));
      assert.equal(new Date(session.expires_at) - new Date(session.created_at), SESSION_TTL_MS);
    });

    it("token reutilizado → 410", async () => {
      await requestLink(allowed.email);
      const token = tokenFromUrl(emailDouble.sent[0].loginUrl);
      assert.equal((await request(app).post("/api/auth/patient-link/consume").send({ token })).status, 200);
      const again = await request(app).post("/api/auth/patient-link/consume").send({ token });
      assert.equal(again.status, 410);
      assert.equal(again.body.status, "invalid_link");
      assert.equal(sessionCookieFrom(again), null);
    });

    it("token vencido → 410", async () => {
      await requestLink(allowed.email);
      const token = tokenFromUrl(emailDouble.sent[0].loginUrl);
      const past = Date.now() - 2 * LOGIN_LINK_TTL_MS;
      await db("patient_login_links")
        .where({ token_hash: hashToken(token) })
        .update({ created_at: new Date(past), expires_at: new Date(past + LOGIN_LINK_TTL_MS) });
      const res = await request(app).post("/api/auth/patient-link/consume").send({ token });
      assert.equal(res.status, 410);
    });

    it("token mal formado o inexistente → 410", async () => {
      for (const token of [undefined, "", "corto", "x".repeat(43), { $ne: null }]) {
        const res = await request(app).post("/api/auth/patient-link/consume").send({ token });
        assert.equal(res.status, 410);
      }
    });

    it("dos consumos simultáneos del mismo token: exactamente uno gana", async () => {
      await requestLink(allowed.email);
      const token = tokenFromUrl(emailDouble.sent[0].loginUrl);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(app).post("/api/auth/patient-link/consume").send({ token }))
      );
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 410, 410, 410, 410]);
      const sessions = await db("patient_auth_sessions").where({ user_id: allowed.id });
      assert.equal(sessions.length, 1);
    });

    it("permiso retirado entre pedido y consumo → 410 y el enlace queda inutilizable", async () => {
      await requestLink(allowed.email);
      const token = tokenFromUrl(emailDouble.sent[0].loginUrl);
      await db("users").where({ id: allowed.id }).update({ allow_passwordless: false });
      assert.equal((await request(app).post("/api/auth/patient-link/consume").send({ token })).status, 410);
      await db("users").where({ id: allowed.id }).update({ allow_passwordless: true });
      assert.equal((await request(app).post("/api/auth/patient-link/consume").send({ token })).status, 410);
    });

    it("enlace abierto en otro navegador/dispositivo: la sesión queda sólo en ese navegador", async () => {
      // Navegador A pide el enlace (sin cookie). El correo se abre en B.
      const browserA = request.agent(app);
      await browserA.post("/api/auth/patient-link/request").send({ email: allowed.email });
      await flushTasks();
      const token = tokenFromUrl(emailDouble.sent[0].loginUrl);
      const browserB = request.agent(app);
      const consumed = await browserB.post("/api/auth/patient-link/consume").send({ token });
      assert.equal(consumed.status, 200);
      assert.equal((await browserB.get("/api/auth/patient-session")).status, 200);
      assert.equal((await browserA.get("/api/auth/patient-session")).status, 401);
    });

    it("rate limit de consumo por IP", async () => {
      process.env.PASSWORDLESS_CONSUME_IP_LIMIT_15MIN = "2";
      const send = () => request(app).post("/api/auth/patient-link/consume").send({ token: "y".repeat(43) });
      assert.equal((await send()).status, 410);
      assert.equal((await send()).status, 410);
      assert.equal((await send()).status, 429);
    });
  });

  describe("sesión persistente", () => {
    it("la cookie autentica /auth/me, restaura la sesión y accede a endpoints de paciente", async () => {
      const { cookie, csrf } = await loginByLink(allowed.email);
      const me = await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie));
      assert.equal(me.status, 200);
      assert.equal(me.body.user.id, allowed.id);

      const restored = await request(app).get("/api/auth/patient-session").set("Cookie", cookieHeader(cookie));
      assert.equal(restored.status, 200);
      assert.equal(restored.body.user.id, allowed.id);
      assert.equal(restored.body.csrf_token, csrf);

      const own = await request(app).get("/api/patient/sessions").set("Cookie", cookieHeader(cookie));
      assert.equal(own.status, 200);
      assert.ok(Array.isArray(own.body));

      // El rol sigue aplicándose: una cookie de paciente no abre rutas de profesional.
      const pro = await request(app).get("/api/patients").set("Cookie", cookieHeader(cookie));
      assert.equal(pro.status, 403);
    });

    it("CSRF: POST con cookie exige X-CSRF-Token válido", async () => {
      const { cookie, csrf } = await loginByLink(allowed.email);
      const noHeader = await request(app).post("/api/patient/sessions").set("Cookie", cookieHeader(cookie)).send({});
      assert.equal(noHeader.status, 403);
      assert.equal(noHeader.body.status, "csrf_failed");
      const wrong = await request(app)
        .post("/api/patient/sessions")
        .set("Cookie", cookieHeader(cookie))
        .set("X-CSRF-Token", csrfTokenForSession(999999))
        .send({});
      assert.equal(wrong.status, 403);
      const ok = await request(app)
        .post("/api/patient/sessions")
        .set("Cookie", cookieHeader(cookie))
        .set("X-CSRF-Token", csrf)
        .send({});
      assert.equal(ok.status, 400, "pasa auth+CSRF y falla validación de body");
      const logout = await request(app).post("/api/auth/patient-session/logout").set("Cookie", cookieHeader(cookie));
      assert.equal(logout.status, 403);
    });

    it("sesión revocada → 401 y la cookie se limpia", async () => {
      const { cookie } = await loginByLink(allowed.email);
      await db("patient_auth_sessions").where({ user_id: allowed.id }).update({ revoked_at: db.fn.now(), revoked_reason: "professional_revoked" });
      const res = await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie));
      assert.equal(res.status, 401);
      assert.equal(res.body.status, "session_invalid");
      assert.match(sessionCookieFrom(res).line, /Max-Age=0/);
    });

    it("cierre de sesión: revoca en DB, limpia la cookie y no afecta otros dispositivos", async () => {
      const deviceA = await loginByLink(allowed.email);
      const deviceB = await loginByLink(allowed.email);
      assert.notEqual(deviceA.cookie, deviceB.cookie);

      const out = await request(app)
        .post("/api/auth/patient-session/logout")
        .set("Cookie", cookieHeader(deviceA.cookie))
        .set("X-CSRF-Token", deviceA.csrf);
      assert.equal(out.status, 204);
      assert.match(sessionCookieFrom(out).line, /Max-Age=0/);
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(deviceA.cookie))).status, 401);
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(deviceB.cookie))).status, 200);
      const revoked = await db("patient_auth_sessions").where({ user_id: allowed.id }).whereNotNull("revoked_at");
      assert.equal(revoked.length, 1);
      assert.equal(revoked[0].revoked_reason, "logout");
    });

    it("logout sin cookie → 204 idempotente", async () => {
      const res = await request(app).post("/api/auth/patient-session/logout");
      assert.equal(res.status, 204);
    });

    it("logout-all revoca todas las sesiones del paciente", async () => {
      const a = await loginByLink(allowed.email);
      const b = await loginByLink(allowed.email);
      const res = await request(app)
        .post("/api/auth/patient-session/logout-all")
        .set("Cookie", cookieHeader(a.cookie))
        .set("X-CSRF-Token", a.csrf);
      assert.equal(res.status, 200);
      assert.equal(res.body.revoked_sessions, 2);
      for (const c of [a.cookie, b.cookie]) {
        assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(c))).status, 401);
      }
    });

    it("expiración absoluta a 30 días", async () => {
      const { cookie } = await loginByLink(allowed.email);
      const created = Date.now() - SESSION_TTL_MS - 1000;
      await db("patient_auth_sessions")
        .where({ user_id: allowed.id })
        .update({ created_at: new Date(created), expires_at: new Date(created + SESSION_TTL_MS), last_used_at: new Date(created) });
      assert.equal((await request(app).get("/api/auth/patient-session").set("Cookie", cookieHeader(cookie))).status, 401);
    });

    it("rotación diaria: token nuevo, gracia corta para el anterior, sin extender el vencimiento", async () => {
      const { cookie: oldToken } = await loginByLink(allowed.email);
      const created = Date.now() - 25 * 60 * 60 * 1000;
      await db("patient_auth_sessions")
        .where({ user_id: allowed.id })
        .update({ created_at: new Date(created), expires_at: new Date(created + SESSION_TTL_MS) });

      const res = await request(app).get("/api/auth/patient-session").set("Cookie", cookieHeader(oldToken));
      assert.equal(res.status, 200);
      const rotated = sessionCookieFrom(res);
      assert.ok(rotated, "debe emitir cookie rotada");
      assert.notEqual(rotated.value, oldToken);
      const row = await db("patient_auth_sessions").where({ user_id: allowed.id }).first();
      assert.equal(row.token_hash, hashToken(rotated.value));
      assert.equal(row.previous_token_hash, hashToken(oldToken));
      assert.equal(new Date(row.expires_at).getTime(), created + SESSION_TTL_MS);

      // Pestaña concurrente con el token anterior: aceptado dentro de la gracia, sin re-rotar.
      const tab2 = await request(app).get("/api/auth/patient-session").set("Cookie", cookieHeader(oldToken));
      assert.equal(tab2.status, 200);
      assert.equal(sessionCookieFrom(tab2), null);

      await db("patient_auth_sessions")
        .where({ id: row.id })
        .update({ rotated_at: new Date(Date.now() - PREVIOUS_TOKEN_GRACE_MS - 1000) });
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(oldToken))).status, 401);
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(rotated.value))).status, 200);
    });

    it("paciente desactivado → la cookie deja de autenticar", async () => {
      const { cookie } = await loginByLink(allowed.email);
      await db("users").where({ id: allowed.id }).update({ is_active: false });
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie))).status, 401);
    });

    it("cookie basura o desconocida → 401", async () => {
      for (const value of ["", "abc", "z".repeat(43)]) {
        const res = await request(app).get("/api/auth/me").set("Cookie", cookieHeader(value));
        assert.equal(res.status, 401);
      }
    });
  });

  describe("reglas D5 y E2 (profesional)", () => {
    it("GET access informa contraseña, sesiones activas y disponibilidad", async () => {
      await loginByLink(allowed.email);
      const res = await request(app).get(`/api/patients/${allowed.id}/access`).set("Authorization", profAuth);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        patient_id: allowed.id,
        allow_passwordless: true,
        has_password: true,
        active_sessions: 1,
        passwordless_login_available: true,
      });
    });

    it("D5: no se puede desactivar el enlace si es el único método de acceso", async () => {
      const res = await request(app)
        .patch(`/api/patients/${linkOnly.id}/access`)
        .set("Authorization", profAuth)
        .send({ allow_passwordless: false, confirm_revoke_sessions: true });
      assert.equal(res.status, 409);
      assert.equal(res.body.status, "last_access_method");
      const row = await db("users").where({ id: linkOnly.id }).first();
      assert.equal(row.allow_passwordless, true);
    });

    it("E2: con sesiones abiertas exige confirmación previa y luego revoca sesiones y enlaces", async () => {
      const { cookie } = await loginByLink(allowed.email);
      await requestLink(allowed.email); // enlace pendiente
      const pendingToken = tokenFromUrl(emailDouble.sent.at(-1).loginUrl);

      const first = await request(app)
        .patch(`/api/patients/${allowed.id}/access`)
        .set("Authorization", profAuth)
        .send({ allow_passwordless: false });
      assert.equal(first.status, 409);
      assert.equal(first.body.status, "confirmation_required");
      assert.equal(first.body.active_sessions, 1);
      assert.equal((await db("users").where({ id: allowed.id }).first()).allow_passwordless, true);
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie))).status, 200);

      const confirmed = await request(app)
        .patch(`/api/patients/${allowed.id}/access`)
        .set("Authorization", profAuth)
        .send({ allow_passwordless: false, confirm_revoke_sessions: true });
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.allow_passwordless, false);
      assert.equal(confirmed.body.revoked_sessions, 1);
      assert.equal(confirmed.body.active_sessions, 0);

      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie))).status, 401);
      const reason = await db("patient_auth_sessions").where({ user_id: allowed.id }).first();
      assert.equal(reason.revoked_reason, "passwordless_disabled");
      await db("users").where({ id: allowed.id }).update({ allow_passwordless: true });
      const consume = await request(app).post("/api/auth/patient-link/consume").send({ token: pendingToken });
      assert.equal(consume.status, 410, "los enlaces pendientes se anulan al desactivar");
    });

    it("E2 sin sesiones abiertas: desactiva directamente", async () => {
      const res = await request(app)
        .patch(`/api/patients/${allowed.id}/access`)
        .set("Authorization", profAuth)
        .send({ allow_passwordless: false });
      assert.equal(res.status, 200);
      assert.equal(res.body.revoked_sessions, 0);
    });

    it("revocar sesiones sin cambiar el permiso; ownership 404 para otro profesional", async () => {
      const { cookie } = await loginByLink(allowed.email);
      const foreign = await request(app)
        .post(`/api/patients/${allowed.id}/access/revoke-sessions`)
        .set("Authorization", otherProfAuth);
      assert.equal(foreign.status, 404);
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie))).status, 200);

      const res = await request(app)
        .post(`/api/patients/${allowed.id}/access/revoke-sessions`)
        .set("Authorization", profAuth);
      assert.equal(res.status, 200);
      assert.equal(res.body.revoked_sessions, 1);
      assert.equal(res.body.allow_passwordless, true);
      assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookieHeader(cookie))).status, 401);
    });

    it("confirm_revoke_sessions con tipo inválido → 400", async () => {
      const res = await request(app)
        .patch(`/api/patients/${allowed.id}/access`)
        .set("Authorization", profAuth)
        .send({ allow_passwordless: false, confirm_revoke_sessions: "sí" });
      assert.equal(res.status, 400);
    });
  });

  describe("regresión de métodos tradicionales", () => {
    it("login con contraseña sigue emitiendo JWT para el mismo paciente", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: allowed.email, password: PASSWORD });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.equal(sessionCookieFrom(res), null, "el login con contraseña no crea cookie");
      const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
      assert.equal(me.status, 200);
    });

    it("Bearer tiene prioridad sobre la cookie y no exige CSRF", async () => {
      const { cookie } = await loginByLink(allowed.email);
      const jwtOther = authHeaderFor(noPermission);
      const me = await request(app).get("/api/auth/me").set("Authorization", jwtOther).set("Cookie", cookieHeader(cookie));
      assert.equal(me.body.user.id, noPermission.id);
      const post = await request(app).post("/api/patient/sessions").set("Authorization", jwtOther).send({});
      assert.equal(post.status, 400, "JWT: sin CSRF, falla sólo validación");
    });

    it("login profesional intacto y sin cookie", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: prof.email, password: PASSWORD });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, "professional");
      assert.equal(sessionCookieFrom(res), null);
    });

    it("el kill switch no afecta login con contraseña", async () => {
      process.env.PATIENT_PASSWORDLESS_ENABLED = "false";
      const res = await request(app).post("/api/auth/login").send({ email: allowed.email, password: PASSWORD });
      assert.equal(res.status, 200);
    });
  });
});
