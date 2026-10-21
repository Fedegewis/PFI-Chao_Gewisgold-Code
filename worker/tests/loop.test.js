import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runOneCycle } from "../src/loop.js";
import { BackendError, BackendErrorCodes } from "../src/backendClient.js";
import { OllamaError, OllamaErrorCodes } from "../src/ollamaClient.js";

const silentLogger = {
  info: () => {}, warn: () => {}, debug: () => {}, error: () => {},
};

const BASE_CONFIG = {
  concurrency: 1,
  delayBetweenSessionsMs: 0,
  idlePollMs: 0,
  heartbeatMs: 10_000_000, // efectivamente sin heartbeat en tests rápidos
  backendRetryMaxMs: 1000,
};

function sampleClaim(overrides = {}) {
  return {
    status: 200,
    body: {
      claim_id: 42,
      claim_token: "tt",
      session_id: 7,
      model: "llama3.2:3b",
      schema_version: "3",
      prompt_version: "3.4",
      prompt: "SYSTEM: hola\nOUTPUT:",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
  };
}

function makeBackendMock({ onClaim, onHeartbeat, onResult, onFailed } = {}) {
  const calls = { claim: 0, heartbeat: 0, result: 0, failed: 0 };
  return {
    calls,
    async claim() { calls.claim++; return onClaim ? onClaim(calls.claim) : { status: 204, body: null }; },
    async heartbeat(args) { calls.heartbeat++; return onHeartbeat ? onHeartbeat(args, calls.heartbeat) : { status: 200, body: { ok: true } }; },
    async result(args) { calls.result++; return onResult ? onResult(args, calls.result) : { status: 200, body: { ok: true, analysis_id: 1 } }; },
    async failed(args) { calls.failed++; return onFailed ? onFailed(args, calls.failed) : { status: 200, body: { ok: true } }; },
  };
}

function makeOllamaMock(behavior) {
  return async ({ prompt, abortSignal }) => behavior({ prompt, abortSignal });
}

describe("worker loop — un ciclo", () => {
  it("cola vacía → kind=idle", async () => {
    const backend = makeBackendMock({ onClaim: () => ({ status: 204, body: null }) });
    const ollama = makeOllamaMock(async () => ({ text: "x", latencyMs: 1 }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "idle");
    assert.equal(backend.calls.claim, 1);
    assert.equal(backend.calls.result, 0);
  });

  it("flujo feliz: claim → ollama → result → kind=processed", async () => {
    const backend = makeBackendMock({ onClaim: () => sampleClaim() });
    const ollama = makeOllamaMock(async () => ({
      text: JSON.stringify({ schema_version: "3", summary: "x", aspects_to_review: [] }),
      latencyMs: 42,
    }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "processed");
    assert.equal(r.claim_id, 42);
    assert.equal(backend.calls.claim, 1);
    assert.equal(backend.calls.result, 1);
    assert.equal(backend.calls.failed, 0);
  });

  it("ollama offline → /failed con OLLAMA_OFFLINE → kind=failed", async () => {
    const backend = makeBackendMock({ onClaim: () => sampleClaim() });
    const ollama = makeOllamaMock(async () => {
      throw new OllamaError(OllamaErrorCodes.OLLAMA_OFFLINE, "no");
    });
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "failed");
    assert.equal(r.error_code, "OLLAMA_OFFLINE");
    assert.equal(backend.calls.failed, 1);
    assert.equal(backend.calls.result, 0);
  });

  it("ollama timeout → /failed con OLLAMA_TIMEOUT", async () => {
    const backend = makeBackendMock({ onClaim: () => sampleClaim() });
    const ollama = makeOllamaMock(async () => { throw new OllamaError(OllamaErrorCodes.OLLAMA_TIMEOUT, "to"); });
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.error_code, "OLLAMA_TIMEOUT");
  });

  it("/result 409 → kind=lost (no reintenta)", async () => {
    const backend = makeBackendMock({
      onClaim: () => sampleClaim(),
      onResult: () => { throw new BackendError(BackendErrorCodes.BACKEND_CLAIM_LOST, "lost", { httpStatus: 409 }); },
    });
    const ollama = makeOllamaMock(async () => ({ text: "{}", latencyMs: 1 }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "lost");
    assert.equal(backend.calls.result, 1);
  });

  it("/result 422 retriable → reintenta una vez y persiste", async () => {
    let results = 0;
    const backend = makeBackendMock({
      onClaim: () => sampleClaim(),
      onResult: () => {
        results++;
        if (results === 1) throw new BackendError(BackendErrorCodes.BACKEND_VALIDATION, "x", { httpStatus: 422, retriable: true, body: { validation_code: "SCHEMA_INVALID", retriable: true } });
        return { status: 200, body: { ok: true } };
      },
    });
    const ollama = makeOllamaMock(async () => ({ text: "{}", latencyMs: 1 }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "processed");
    assert.equal(backend.calls.result, 2);
  });

  it("/result 422 NO retriable → kind=failed sin reintentar", async () => {
    const backend = makeBackendMock({
      onClaim: () => sampleClaim(),
      onResult: () => { throw new BackendError(BackendErrorCodes.BACKEND_VALIDATION, "x", { httpStatus: 422, retriable: false, body: { validation_code: "UNEXPECTED_FIELD" } }); },
    });
    const ollama = makeOllamaMock(async () => ({ text: "{}", latencyMs: 1 }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "failed");
    assert.equal(backend.calls.result, 1);
  });

  it("heartbeat con CLAIM_LOST → aborta inferencia → kind=lost (sin enviar result)", async () => {
    // Config con heartbeat agresivo.
    const config = { ...BASE_CONFIG, heartbeatMs: 20 };
    const backend = makeBackendMock({
      onClaim: () => sampleClaim(),
      onHeartbeat: () => { throw new BackendError(BackendErrorCodes.BACKEND_CLAIM_LOST, "lost", { httpStatus: 409 }); },
    });
    // Ollama "lento": espera 200 ms, pero debe cancelarse via abortSignal.
    const ollama = async ({ abortSignal }) => {
      return new Promise((_, reject) => {
        const t = setTimeout(() => reject(new OllamaError(OllamaErrorCodes.OLLAMA_TIMEOUT, "slow")), 500);
        abortSignal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new OllamaError(OllamaErrorCodes.OLLAMA_TIMEOUT, "aborted"), { name: "AbortError" }));
        });
      });
    };
    const r = await runOneCycle({
      backend, ollama, config, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "lost");
    assert.equal(backend.calls.result, 0, "no se envía resultado obsoleto");
  });

  it("backend offline en /claim → kind=backend_error retriable", async () => {
    const backend = makeBackendMock({
      onClaim: () => { throw new BackendError(BackendErrorCodes.BACKEND_OFFLINE, "off", { retriable: true }); },
    });
    const ollama = makeOllamaMock(async () => ({ text: "{}", latencyMs: 1 }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "backend_error");
    assert.equal(r.error.code, "BACKEND_OFFLINE");
  });

  it("backend 401 en /claim → kind=backend_error con BACKEND_AUTH", async () => {
    const backend = makeBackendMock({
      onClaim: () => { throw new BackendError(BackendErrorCodes.BACKEND_AUTH, "auth", { httpStatus: 401, retriable: false }); },
    });
    const ollama = makeOllamaMock(async () => ({ text: "{}", latencyMs: 1 }));
    const r = await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(r.kind, "backend_error");
    assert.equal(r.error.code, "BACKEND_AUTH");
  });

  it("no procesa más de una sesión por ciclo (sólo UN /claim por runOneCycle)", async () => {
    const backend = makeBackendMock({ onClaim: () => sampleClaim() });
    const ollama = makeOllamaMock(async () => ({ text: JSON.stringify({ schema_version: "3", summary: "x", aspects_to_review: [] }), latencyMs: 10 }));
    await runOneCycle({
      backend, ollama, config: BASE_CONFIG, logger: silentLogger,
      shutdownSignal: new AbortController().signal,
    });
    assert.equal(backend.calls.claim, 1, "exactamente un /claim por ciclo");
  });
});
