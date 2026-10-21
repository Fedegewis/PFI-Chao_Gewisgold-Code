import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBackendClient, BackendError, BackendErrorCodes } from "../src/backendClient.js";

const TOKEN = "x".repeat(48);
const URL_ = "http://localhost:3001";

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (typeof next === "function") return next();
    return next;
  };
  fn.calls = calls;
  return fn;
}

function makeRes(status, body = null, { throwOnJson = false } = {}) {
  const text = body === null ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => {
      if (throwOnJson) throw new Error("not json");
      return body;
    },
  };
}

describe("backendClient", () => {
  describe("claim", () => {
    it("200 → devuelve body", async () => {
      const fetchImpl = mockFetch([
        makeRes(200, { claim_id: 1, claim_token: "t", prompt: "p", session_id: 2, model: "m", schema_version: "3", prompt_version: "3.4", lease_expires_at: new Date().toISOString() }),
      ]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      const r = await client.claim();
      assert.equal(r.status, 200);
      assert.equal(r.body.claim_id, 1);
    });

    it("204 → body null", async () => {
      const fetchImpl = mockFetch([makeRes(204, null)]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      const r = await client.claim();
      assert.equal(r.status, 204);
      assert.equal(r.body, null);
    });

    it("Authorization: Bearer <token> es enviado", async () => {
      const fetchImpl = mockFetch([makeRes(204)]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await client.claim();
      assert.equal(fetchImpl.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(fetchImpl.calls[0].init.headers["Content-Type"], "application/json");
    });

    it("401 → BACKEND_AUTH (no retriable)", async () => {
      const fetchImpl = mockFetch([makeRes(401, { error: "no" })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.claim(),
        (err) => err instanceof BackendError && err.code === BackendErrorCodes.BACKEND_AUTH && err.retriable === false
      );
    });

    it("503 → BACKEND_AUTH (worker_disabled)", async () => {
      const fetchImpl = mockFetch([makeRes(503, { status: "worker_disabled" })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.claim(),
        (err) => err instanceof BackendError && err.code === BackendErrorCodes.BACKEND_AUTH
      );
    });

    it("500 → BACKEND_SERVER (retriable)", async () => {
      const fetchImpl = mockFetch([makeRes(500)]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.claim(),
        (err) => err instanceof BackendError && err.code === BackendErrorCodes.BACKEND_SERVER && err.retriable === true
      );
    });

    it("ECONNREFUSED → BACKEND_OFFLINE (retriable)", async () => {
      const fetchImpl = mockFetch([() => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }); }]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.claim(),
        (err) => err instanceof BackendError && err.code === BackendErrorCodes.BACKEND_OFFLINE && err.retriable === true
      );
    });

    it("AbortError → BACKEND_TIMEOUT", async () => {
      const fetchImpl = mockFetch([() => { throw Object.assign(new Error("abort"), { name: "AbortError" }); }]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.claim(),
        (err) => err instanceof BackendError && err.code === BackendErrorCodes.BACKEND_TIMEOUT
      );
    });

    it("mensajes de error NO contienen el token", async () => {
      const fetchImpl = mockFetch([makeRes(401, { error: `invalid: ${TOKEN}` })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      try {
        await client.claim();
        assert.fail("debería haber lanzado");
      } catch (err) {
        assert.ok(err instanceof BackendError);
        assert.ok(!err.message.includes(TOKEN), "message no debe filtrar el token");
      }
    });
  });

  describe("result + failed + heartbeat", () => {
    it("heartbeat envía claim_id y claim_token", async () => {
      const fetchImpl = mockFetch([makeRes(200, { ok: true })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await client.heartbeat({ claimId: 42, claimToken: "tt" });
      const body = JSON.parse(fetchImpl.calls[0].init.body);
      assert.equal(body.claim_id, 42);
      assert.equal(body.claim_token, "tt");
    });

    it("heartbeat 409 → BACKEND_CLAIM_LOST", async () => {
      const fetchImpl = mockFetch([makeRes(409, { code: "CLAIM_LOST" })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.heartbeat({ claimId: 1, claimToken: "x" }),
        (err) => err.code === BackendErrorCodes.BACKEND_CLAIM_LOST
      );
    });

    it("result envía raw_text y latency_ms", async () => {
      const fetchImpl = mockFetch([makeRes(200, { ok: true })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await client.result({ claimId: 1, claimToken: "t", rawText: "x", latencyMs: 123 });
      const body = JSON.parse(fetchImpl.calls[0].init.body);
      assert.equal(body.raw_text, "x");
      assert.equal(body.latency_ms, 123);
    });

    it("result 422 retriable=true → BACKEND_VALIDATION retriable", async () => {
      const fetchImpl = mockFetch([makeRes(422, { code: "VALIDATION_FAILED", validation_code: "SCHEMA_INVALID", retriable: true })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await assert.rejects(
        client.result({ claimId: 1, claimToken: "t", rawText: "x" }),
        (err) => err.code === BackendErrorCodes.BACKEND_VALIDATION && err.retriable === true
      );
    });

    it("failed envía error_code y error_message", async () => {
      const fetchImpl = mockFetch([makeRes(200, { ok: true })]);
      const client = createBackendClient({ backendUrl: URL_, token: TOKEN, fetchImpl });
      await client.failed({ claimId: 1, claimToken: "t", errorCode: "OLLAMA_OFFLINE", errorMessage: "bye", latencyMs: 5 });
      const body = JSON.parse(fetchImpl.calls[0].init.body);
      assert.equal(body.error_code, "OLLAMA_OFFLINE");
      assert.equal(body.error_message, "bye");
      assert.equal(body.latency_ms, 5);
    });
  });
});
