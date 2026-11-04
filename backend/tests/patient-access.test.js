// F1 — permiso individual de acceso sin contraseña (users.allow_passwordless).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import request from "supertest";
import app from "../src/app.js";
import db from "../src/db/connection.js";
import { authHeaderFor } from "./helpers.js";

const EMAIL_SUFFIX = "@patient-access-test.com";
const PATIENT_PASSWORD = "clave-de-prueba-123";

async function cleanTestData() {
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

describe("Patient passwordless access permission (F1)", () => {
  let profA;
  let profB;
  let profAAuth;
  let profBAuth;
  let patientA;
  let patientAAuth;
  let patientB;

  before(async () => {
    await cleanTestData();
    const stamp = Date.now();

    [profA] = await db("users")
      .insert({ role: "professional", name: "Prof A", email: `prof-a-${stamp}${EMAIL_SUFFIX}` })
      .returning("*");
    [profB] = await db("users")
      .insert({ role: "professional", name: "Prof B", email: `prof-b-${stamp}${EMAIL_SUFFIX}` })
      .returning("*");
    profAAuth = authHeaderFor(profA);
    profBAuth = authHeaderFor(profB);

    // Inserción SIN allow_passwordless: simula un paciente preexistente.
    [patientA] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente A",
        email: `pa-${stamp}${EMAIL_SUFFIX}`,
        professional_id: profA.id,
        password_hash: await bcrypt.hash(PATIENT_PASSWORD, 4),
      })
      .returning("*");
    [patientB] = await db("users")
      .insert({
        role: "patient",
        name: "Paciente B",
        email: `pb-${stamp}${EMAIL_SUFFIX}`,
        professional_id: profB.id,
      })
      .returning("*");
    patientAAuth = authHeaderFor(patientA);
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  describe("schema", () => {
    it("la columna es boolean NOT NULL con default false", async () => {
      const info = await db("users").columnInfo("allow_passwordless");
      assert.equal(info.type, "boolean");
      assert.equal(info.nullable, false);
      assert.match(String(info.defaultValue), /false/);
    });

    it("un paciente creado sin el campo queda en false", () => {
      assert.equal(patientA.allow_passwordless, false);
      assert.equal(patientB.allow_passwordless, false);
    });
  });

  describe("GET /api/patients/:id/access", () => {
    it("el profesional dueño consulta el permiso (default false, flujo no disponible sin flag)", async () => {
      const res = await request(app)
        .get(`/api/patients/${patientA.id}/access`)
        .set("Authorization", profAAuth)
        .expect(200);
      assert.deepEqual(res.body, {
        patient_id: patientA.id,
        allow_passwordless: false,
        // F2/F3: el endpoint también informa métodos y sesiones abiertas.
        has_password: true,
        active_sessions: 0,
        passwordless_login_available: false,
      });
    });

    it("un profesional ajeno recibe 404", async () => {
      await request(app)
        .get(`/api/patients/${patientA.id}/access`)
        .set("Authorization", profBAuth)
        .expect(404);
    });

    it("un paciente recibe 403", async () => {
      await request(app)
        .get(`/api/patients/${patientA.id}/access`)
        .set("Authorization", patientAAuth)
        .expect(403);
    });

    it("sin token recibe 401", async () => {
      await request(app).get(`/api/patients/${patientA.id}/access`).expect(401);
    });

    it("id inválido o de un profesional recibe 404", async () => {
      await request(app).get("/api/patients/abc/access").set("Authorization", profAAuth).expect(404);
      await request(app).get(`/api/patients/${profB.id}/access`).set("Authorization", profAAuth).expect(404);
    });
  });

  describe("PATCH /api/patients/:id/access", () => {
    it("el profesional dueño activa y desactiva el permiso, y persiste", async () => {
      const on = await request(app)
        .patch(`/api/patients/${patientA.id}/access`)
        .set("Authorization", profAAuth)
        .send({ allow_passwordless: true })
        .expect(200);
      assert.equal(on.body.allow_passwordless, true);
      assert.equal(on.body.passwordless_login_available, false);

      const row = await db("users").where({ id: patientA.id }).first();
      assert.equal(row.allow_passwordless, true);

      const reread = await request(app)
        .get(`/api/patients/${patientA.id}/access`)
        .set("Authorization", profAAuth)
        .expect(200);
      assert.equal(reread.body.allow_passwordless, true);

      const list = await request(app).get("/api/patients").set("Authorization", profAAuth).expect(200);
      assert.equal(list.body.find((p) => p.id === patientA.id).allow_passwordless, true);

      const off = await request(app)
        .patch(`/api/patients/${patientA.id}/access`)
        .set("Authorization", profAAuth)
        .send({ allow_passwordless: false })
        .expect(200);
      assert.equal(off.body.allow_passwordless, false);
    });

    it("no modifica la contraseña ni otros campos del paciente", async () => {
      const before = await db("users").where({ id: patientA.id }).first();
      await request(app)
        .patch(`/api/patients/${patientA.id}/access`)
        .set("Authorization", profAAuth)
        .send({ allow_passwordless: true })
        .expect(200);
      const afterRow = await db("users").where({ id: patientA.id }).first();
      assert.equal(afterRow.password_hash, before.password_hash);
      assert.equal(afterRow.role, "patient");
      assert.equal(afterRow.email, before.email);
      assert.equal(afterRow.professional_id, profA.id);
      assert.equal(afterRow.is_active, true);
    });

    it("un profesional ajeno recibe 404 y no cambia nada", async () => {
      await request(app)
        .patch(`/api/patients/${patientB.id}/access`)
        .set("Authorization", profAAuth)
        .send({ allow_passwordless: true })
        .expect(404);
      const row = await db("users").where({ id: patientB.id }).first();
      assert.equal(row.allow_passwordless, false);
    });

    it("el paciente no puede modificar su propio permiso (403)", async () => {
      const beforeRow = await db("users").where({ id: patientA.id }).first();
      await request(app)
        .patch(`/api/patients/${patientA.id}/access`)
        .set("Authorization", patientAAuth)
        .send({ allow_passwordless: !beforeRow.allow_passwordless })
        .expect(403);
      const afterRow = await db("users").where({ id: patientA.id }).first();
      assert.equal(afterRow.allow_passwordless, beforeRow.allow_passwordless);
    });

    for (const [label, payload] of [
      ["string 'true'", { allow_passwordless: "true" }],
      ["número 1", { allow_passwordless: 1 }],
      ["null", { allow_passwordless: null }],
      ["campo ausente", {}],
      ["array", [true]],
    ]) {
      it(`rechaza valor inválido: ${label} (400)`, async () => {
        await request(app)
          .patch(`/api/patients/${patientA.id}/access`)
          .set("Authorization", profAAuth)
          .send(payload)
          .expect(400);
      });
    }

    it("rechaza campos sensibles o extra (400) sin aplicar cambios", async () => {
      const beforeRow = await db("users").where({ id: patientA.id }).first();
      for (const extra of [
        { role: "professional" },
        { professional_id: profB.id },
        { password_hash: "x" },
        { is_active: false },
        { email: `otro${EMAIL_SUFFIX}` },
      ]) {
        const res = await request(app)
          .patch(`/api/patients/${patientA.id}/access`)
          .set("Authorization", profAAuth)
          .send({ allow_passwordless: !beforeRow.allow_passwordless, ...extra })
          .expect(400);
        assert.match(res.body.error, /Campos no permitidos/);
      }
      const afterRow = await db("users").where({ id: patientA.id }).first();
      assert.equal(afterRow.allow_passwordless, beforeRow.allow_passwordless);
      assert.equal(afterRow.role, "patient");
      assert.equal(afterRow.professional_id, profA.id);
      assert.equal(afterRow.is_active, true);
    });
  });

  describe("compatibilidad con el login tradicional", () => {
    it("con el permiso activado el paciente sigue entrando con contraseña", async () => {
      await db("users").where({ id: patientA.id }).update({ allow_passwordless: true });
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: patientA.email, password: PATIENT_PASSWORD })
        .expect(200);
      assert.equal(res.body.user.id, patientA.id);
      assert.ok(res.body.token);
    });

    it("el permiso no habilita entrar sin contraseña ni con una contraseña errónea", async () => {
      await request(app).post("/api/auth/login").send({ email: patientA.email }).expect(400);
      await request(app)
        .post("/api/auth/login")
        .send({ email: patientA.email, password: "incorrecta" })
        .expect(401);
    });

    it("un paciente sin password_hash sigue sin poder entrar aunque tenga el permiso", async () => {
      await db("users").where({ id: patientB.id }).update({ allow_passwordless: true });
      await request(app)
        .post("/api/auth/login")
        .send({ email: patientB.email, password: "lo-que-sea" })
        .expect(401);
    });
  });
});
