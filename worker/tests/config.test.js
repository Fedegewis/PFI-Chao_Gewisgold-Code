import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError, WORKER_TOKEN_MIN_LENGTH } from "../src/config.js";

const VALID_TOKEN = "a".repeat(WORKER_TOKEN_MIN_LENGTH);

function base(extra = {}) {
  return {
    WORKER_BACKEND_URL: "https://api.menteactiva.ar",
    WORKER_TOKEN: VALID_TOKEN,
    ...extra,
  };
}

describe("config.loadConfig", () => {
  it("acepta HTTPS en producción", () => {
    const c = loadConfig(base());
    assert.equal(c.backendUrl, "https://api.menteactiva.ar");
  });

  it("acepta http://localhost para desarrollo", () => {
    const c = loadConfig(base({ WORKER_BACKEND_URL: "http://localhost:3001" }));
    assert.equal(c.backendUrl, "http://localhost:3001");
  });

  it("acepta http://127.0.0.1 para desarrollo", () => {
    const c = loadConfig(base({ WORKER_BACKEND_URL: "http://127.0.0.1:3001" }));
    assert.equal(c.backendUrl, "http://127.0.0.1:3001");
  });

  it("rechaza http:// con dominio no-local", () => {
    assert.throws(
      () => loadConfig(base({ WORKER_BACKEND_URL: "http://api.menteactiva.ar" })),
      (err) => err instanceof ConfigError && err.field === "WORKER_BACKEND_URL"
    );
  });

  it("rechaza protocolos exóticos", () => {
    assert.throws(
      () => loadConfig(base({ WORKER_BACKEND_URL: "ftp://example.com" })),
      (err) => err instanceof ConfigError
    );
  });

  it("rechaza URL vacía", () => {
    assert.throws(
      () => loadConfig(base({ WORKER_BACKEND_URL: "" })),
      (err) => err instanceof ConfigError
    );
  });

  it("rechaza URL malformada", () => {
    assert.throws(
      () => loadConfig(base({ WORKER_BACKEND_URL: "no-es-url" })),
      (err) => err instanceof ConfigError
    );
  });

  it("rechaza token ausente", () => {
    assert.throws(
      () => loadConfig(base({ WORKER_TOKEN: undefined })),
      (err) => err instanceof ConfigError && err.field === "WORKER_TOKEN"
    );
  });

  it("rechaza token demasiado corto", () => {
    assert.throws(
      () => loadConfig(base({ WORKER_TOKEN: "corto" })),
      (err) => err instanceof ConfigError && err.field === "WORKER_TOKEN"
    );
  });

  it("defaults operativos cuando no se setean", () => {
    const c = loadConfig(base());
    assert.equal(c.concurrency, 1);
    assert.equal(c.delayBetweenSessionsMs, 10_000);
    assert.equal(c.idlePollMs, 30_000);
    assert.equal(c.heartbeatMs, 60_000);
    assert.equal(c.model, "llama3.2:3b");
    assert.equal(c.ollamaUrl, "http://127.0.0.1:11434");
  });

  it("overrides respetados", () => {
    const c = loadConfig(base({
      WORKER_CONCURRENCY: "2",
      WORKER_DELAY_MS: "5000",
      WORKER_IDLE_POLL_MS: "15000",
      WORKER_HEARTBEAT_MS: "40000",
      WORKER_MODEL: "llama-3.1-8b",
      WORKER_OLLAMA_URL: "http://127.0.0.1:12345",
    }));
    assert.equal(c.concurrency, 2);
    assert.equal(c.delayBetweenSessionsMs, 5000);
    assert.equal(c.idlePollMs, 15000);
    assert.equal(c.heartbeatMs, 40000);
    assert.equal(c.model, "llama-3.1-8b");
    assert.equal(c.ollamaUrl, "http://127.0.0.1:12345");
  });

  it("trailing slash removido de las URLs", () => {
    const c = loadConfig(base({
      WORKER_BACKEND_URL: "https://api.menteactiva.ar/",
      WORKER_OLLAMA_URL: "http://127.0.0.1:11434/",
    }));
    assert.equal(c.backendUrl, "https://api.menteactiva.ar");
    assert.equal(c.ollamaUrl, "http://127.0.0.1:11434");
  });
});
