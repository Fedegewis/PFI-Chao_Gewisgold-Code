// W-1: autenticación exclusiva del worker (WORKER_TOKEN).

import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

const VALID_TOKEN = "a".repeat(48);

const ENV_KEYS = ["WORKER_TOKEN", "AI_ENABLED"];
const originalEnv = {};
function saveEnv() { for (const k of ENV_KEYS) originalEnv[k] = process.env[k]; }
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
}

// Import app DESPUÉS de setear WORKER_TOKEN para que el middleware lo lea
// en cada request (lo hace de todos modos, pero evita confusión).
process.env.WORKER_TOKEN = VALID_TOKEN;
const { default: app } = await import("../src/app.js");
const { default: db } = await import("../src/db/connection.js");

describe("Worker auth (WORKER_TOKEN)", () => {
  before(() => { saveEnv(); process.env.WORKER_TOKEN = VALID_TOKEN; });
  afterEach(() => { process.env.WORKER_TOKEN = VALID_TOKEN; });
  after(async () => { restoreEnv(); await db.destroy(); });

  it("401 cuando falta el header Authorization", async () => {
    const res = await request(app).post("/api/worker/analysis/claim");
    assert.equal(res.status, 401);
  });

  it("401 cuando el header no es Bearer", async () => {
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Basic ${VALID_TOKEN}`);
    assert.equal(res.status, 401);
  });

  it("401 con token incorrecto (misma longitud)", async () => {
    const bad = "b".repeat(48);
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer ${bad}`);
    assert.equal(res.status, 401);
  });

  it("401 con token incorrecto (longitud distinta)", async () => {
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer short`);
    assert.equal(res.status, 401);
  });

  it("503 cuando WORKER_TOKEN no está configurado en el servidor", async () => {
    delete process.env.WORKER_TOKEN;
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "worker_disabled");
  });

  it("503 cuando WORKER_TOKEN es más corto que el mínimo requerido", async () => {
    process.env.WORKER_TOKEN = "short";
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer short`);
    assert.equal(res.status, 503);
    assert.equal(res.body.status, "worker_disabled");
  });

  it("passthrough con token válido (ruta sigue y responde 204 por cola vacía o 200)", async () => {
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    // El resultado específico depende de la DB; lo que validamos acá es
    // que el middleware NO rechazó la request (ni 401 ni 503).
    assert.ok(res.status === 200 || res.status === 204, `status fue ${res.status}`);
  });

  it("no filtra el token configurado ni el presentado en el error 401", async () => {
    const bad = "c".repeat(48);
    const res = await request(app)
      .post("/api/worker/analysis/claim")
      .set("Authorization", `Bearer ${bad}`);
    const body = JSON.stringify(res.body || {});
    assert.ok(!body.includes(bad), "no debe aparecer el token presentado");
    assert.ok(!body.includes(VALID_TOKEN), "no debe aparecer el token configurado");
  });
});
