import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOllamaClient, createOllamaHealthCheck, OllamaError, OllamaErrorCodes, resolveGenerationOptions } from "../src/ollamaClient.js";

function makeRes(status, body) {
  const text = body === null ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof body === "object" ? body : (() => { throw new Error("x"); })()),
  };
}

describe("ollamaClient", () => {
  it("200 con response devuelve text y latencyMs", async () => {
    const fetchImpl = async () => makeRes(200, { response: "hola" });
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    const r = await generate({ prompt: "p" });
    assert.equal(r.text, "hola");
    assert.ok(r.latencyMs >= 0);
  });

  it("payload incluye format=json, options.temperature y keep_alive", async () => {
    let captured;
    const fetchImpl = async (_url, init) => {
      captured = JSON.parse(init.body);
      return makeRes(200, { response: "ok" });
    };
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await generate({ prompt: "x" });
    assert.equal(captured.model, "llama3.2:3b");
    assert.equal(captured.stream, false);
    assert.equal(captured.format, "json");
    assert.equal(captured.options.temperature, 0.2);
    assert.equal(captured.keep_alive, "30m");
  });

  it("sin generationOptions usa los parámetros por defecto (num_predict 300)", async () => {
    let captured;
    const fetchImpl = async (_url, init) => {
      captured = JSON.parse(init.body);
      return makeRes(200, { response: "ok" });
    };
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await generate({ prompt: "x" });
    assert.deepEqual(captured.options, { temperature: 0.2, num_predict: 300 });
  });

  it("generationOptions del claim (3.6) ajusta num_predict y temperature", async () => {
    let captured;
    const fetchImpl = async (_url, init) => {
      captured = JSON.parse(init.body);
      return makeRes(200, { response: "ok" });
    };
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await generate({ prompt: "x", generationOptions: { num_predict: 700, temperature: 0.2 } });
    assert.deepEqual(captured.options, { temperature: 0.2, num_predict: 700 });
  });

  it("resolveGenerationOptions ignora claves desconocidas y valores fuera de rango", () => {
    assert.deepEqual(resolveGenerationOptions({ num_predict: 999999, temperature: 5, seed: 1, mirostat: 2 }), { temperature: 0.2, num_predict: 300 });
    assert.deepEqual(resolveGenerationOptions({ num_predict: "700" }), { temperature: 0.2, num_predict: 300 });
    assert.deepEqual(resolveGenerationOptions(null), { temperature: 0.2, num_predict: 300 });
  });

  it("200 con response vacía → EMPTY_RESPONSE", async () => {
    const fetchImpl = async () => makeRes(200, { response: "" });
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await assert.rejects(generate({ prompt: "x" }), (err) => err instanceof OllamaError && err.code === OllamaErrorCodes.OLLAMA_EMPTY_RESPONSE);
  });

  it("404 con 'not found' en body → MODEL_NOT_FOUND", async () => {
    const fetchImpl = async () => ({
      ok: false, status: 404,
      text: async () => '{"error":"model not found"}',
      json: async () => ({ error: "model not found" }),
    });
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await assert.rejects(generate({ prompt: "x" }), (err) => err.code === OllamaErrorCodes.OLLAMA_MODEL_NOT_FOUND);
  });

  it("500 → OLLAMA_HTTP_ERROR", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "", json: async () => ({}) });
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await assert.rejects(generate({ prompt: "x" }), (err) => err.code === OllamaErrorCodes.OLLAMA_HTTP_ERROR);
  });

  it("ECONNREFUSED → OLLAMA_OFFLINE", async () => {
    const fetchImpl = async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }); };
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", fetchImpl });
    await assert.rejects(generate({ prompt: "x" }), (err) => err.code === OllamaErrorCodes.OLLAMA_OFFLINE);
  });

  it("timeout → OLLAMA_TIMEOUT", async () => {
    const fetchImpl = async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("abort"), { name: "AbortError" }));
        });
      });
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", timeoutMs: 20, fetchImpl });
    await assert.rejects(generate({ prompt: "x" }), (err) => err.code === OllamaErrorCodes.OLLAMA_TIMEOUT);
  });

  it("abortSignal externo cancela la inferencia", async () => {
    const fetchImpl = async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("abort"), { name: "AbortError" }));
        });
      });
    const generate = createOllamaClient({ ollamaUrl: "http://127.0.0.1:11434", model: "llama3.2:3b", timeoutMs: 60_000, fetchImpl });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await assert.rejects(generate({ prompt: "x", abortSignal: ctrl.signal }), (err) => err.code === OllamaErrorCodes.OLLAMA_TIMEOUT);
  });
});

describe("ollamaClient — health check previo al claim", () => {
  const opts = { ollamaUrl: "http://127.0.0.1:11434/", model: "llama3.2:3b" };

  it("modelo presente en /api/tags → ok", async () => {
    let url;
    const fetchImpl = async (u) => { url = u; return makeRes(200, { models: [{ name: "llama3.2:3b" }] }); };
    const check = createOllamaHealthCheck({ ...opts, fetchImpl });
    assert.deepEqual(await check(), { ok: true });
    assert.equal(url, "http://127.0.0.1:11434/api/tags");
  });

  it("modelo ausente → OLLAMA_MODEL_NOT_FOUND", async () => {
    const fetchImpl = async () => makeRes(200, { models: [{ name: "otro:1b" }] });
    const check = createOllamaHealthCheck({ ...opts, fetchImpl });
    assert.deepEqual(await check(), { ok: false, code: OllamaErrorCodes.OLLAMA_MODEL_NOT_FOUND });
  });

  it("ECONNREFUSED → OLLAMA_OFFLINE sin lanzar", async () => {
    const fetchImpl = async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }); };
    const check = createOllamaHealthCheck({ ...opts, fetchImpl });
    assert.deepEqual(await check(), { ok: false, code: OllamaErrorCodes.OLLAMA_OFFLINE });
  });

  it("HTTP 500 → OLLAMA_HTTP_ERROR", async () => {
    const fetchImpl = async () => makeRes(500, {});
    const check = createOllamaHealthCheck({ ...opts, fetchImpl });
    assert.deepEqual(await check(), { ok: false, code: OllamaErrorCodes.OLLAMA_HTTP_ERROR });
  });

  it("sin respuesta dentro del timeout → no ok, sin lanzar", async () => {
    const fetchImpl = async (_u, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" })));
    });
    const check = createOllamaHealthCheck({ ...opts, timeoutMs: 20, fetchImpl });
    const r = await check();
    assert.equal(r.ok, false);
    assert.equal(r.code, OllamaErrorCodes.OLLAMA_TIMEOUT);
  });
});
