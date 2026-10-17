// 7C: tests unitarios del cliente Ollama.
// - No requieren Ollama real: se inyecta `fetchImpl`.
// - No tocan la base de datos ni las rutas.
// - Restauran process.env después de cada caso.

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generate,
  getOllamaConfig,
  isAiEnabled,
} from "../src/services/ai/ollamaClient.js";
import {
  OllamaClientError,
  OllamaErrorCodes,
} from "../src/services/ai/errors.js";

const ENV_KEYS = [
  "AI_ENABLED",
  "OLLAMA_URL",
  "OLLAMA_MODEL",
  "OLLAMA_TIMEOUT_MS",
  "OLLAMA_EXTRA_HEADERS",
];
const originalEnv = {};

function saveEnv() {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function mockFetchOk({ response = "hola", extra = {} } = {}) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ response, ...extra }),
    text: async () => JSON.stringify({ response, ...extra }),
  });
}

function mockFetchStatus(status, bodyText = "") {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      try { return JSON.parse(bodyText); } catch { throw new Error("not json"); }
    },
    text: async () => bodyText,
  });
}

describe("ollamaClient", () => {
  before(() => { saveEnv(); });
  after(() => { restoreEnv(); });

  beforeEach(() => {
    // Default para casi todos los tests: IA habilitada.
    process.env.AI_ENABLED = "true";
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_TIMEOUT_MS;
  });

  afterEach(() => {
    // Limpiamos entre casos por si un test específico sobreescribió algo.
    for (const key of ENV_KEYS) delete process.env[key];
  });

  describe("config", () => {
    it("aplica defaults cuando no hay env", () => {
      const cfg = getOllamaConfig();
      assert.equal(cfg.url, "http://localhost:11434");
      assert.equal(cfg.model, "llama3.2:3b");
      assert.equal(cfg.timeoutMs, 30000);
      assert.equal(cfg.enabled, true);
    });

    it("respeta OLLAMA_URL/OLLAMA_MODEL/OLLAMA_TIMEOUT_MS", () => {
      process.env.OLLAMA_URL = "http://ollama.internal:9999/";
      process.env.OLLAMA_MODEL = "llama3.1:8b";
      process.env.OLLAMA_TIMEOUT_MS = "5000";
      const cfg = getOllamaConfig();
      assert.equal(cfg.url, "http://ollama.internal:9999"); // strip trailing slash
      assert.equal(cfg.model, "llama3.1:8b");
      assert.equal(cfg.timeoutMs, 5000);
    });

    it("timeout inválido cae al default", () => {
      process.env.OLLAMA_TIMEOUT_MS = "no-es-numero";
      assert.equal(getOllamaConfig().timeoutMs, 30000);
      process.env.OLLAMA_TIMEOUT_MS = "-10";
      assert.equal(getOllamaConfig().timeoutMs, 30000);
    });

    it("isAiEnabled refleja AI_ENABLED", () => {
      process.env.AI_ENABLED = "true";
      assert.equal(isAiEnabled(), true);
      process.env.AI_ENABLED = "false";
      assert.equal(isAiEnabled(), false);
      delete process.env.AI_ENABLED;
      assert.equal(isAiEnabled(), false);
    });
  });

  describe("guardas de entrada", () => {
    it("lanza si prompt no es string no vacío", async () => {
      await assert.rejects(() => generate({}, { fetchImpl: mockFetchOk() }), TypeError);
      await assert.rejects(() => generate({ prompt: "" }, { fetchImpl: mockFetchOk() }), TypeError);
      await assert.rejects(() => generate({ prompt: 42 }, { fetchImpl: mockFetchOk() }), TypeError);
    });

    it("lanza OLLAMA_DISABLED cuando AI_ENABLED != 'true'", async () => {
      process.env.AI_ENABLED = "false";
      await assert.rejects(
        () => generate({ prompt: "hola" }, { fetchImpl: mockFetchOk() }),
        (err) =>
          err instanceof OllamaClientError &&
          err.code === OllamaErrorCodes.OLLAMA_DISABLED
      );
    });

    it("cuando AI_ENABLED no está definido, también DISABLED", async () => {
      delete process.env.AI_ENABLED;
      await assert.rejects(
        () => generate({ prompt: "hola" }, { fetchImpl: mockFetchOk() }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_DISABLED
      );
    });
  });

  describe("happy path", () => {
    it("devuelve text, raw, latencyMs y model", async () => {
      const stub = mockFetchOk({ response: "salida modelo" });
      const out = await generate({ prompt: "ping" }, { fetchImpl: stub });
      assert.equal(out.text, "salida modelo");
      assert.equal(out.model, "llama3.2:3b");
      assert.equal(typeof out.latencyMs, "number");
      assert.ok(out.latencyMs >= 0);
      assert.equal(out.raw.response, "salida modelo");
    });

    it("envía el body correcto (stream:false, format, options)", async () => {
      let captured;
      const stub = async (url, init) => {
        captured = { url, init };
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: "ok" }),
          text: async () => "",
        };
      };
      await generate(
        { prompt: "hola", format: "json", options: { temperature: 0.1 } },
        { fetchImpl: stub }
      );
      assert.equal(captured.url, "http://localhost:11434/api/generate");
      assert.equal(captured.init.method, "POST");
      assert.equal(captured.init.headers["Content-Type"], "application/json");
      const body = JSON.parse(captured.init.body);
      assert.equal(body.model, "llama3.2:3b");
      assert.equal(body.prompt, "hola");
      assert.equal(body.stream, false);
      assert.equal(body.format, "json");
      assert.deepEqual(body.options, { temperature: 0.1 });
      // keepAlive no fue pasado → no debe aparecer en el body.
      assert.equal(body.keep_alive, undefined);
    });

    it("propaga keepAlive como keep_alive top-level en el body cuando el caller lo pasa", async () => {
      let captured;
      const stub = async (_url, init) => {
        captured = JSON.parse(init.body);
        return {
          ok: true, status: 200,
          json: async () => ({ response: "ok" }),
          text: async () => "",
        };
      };
      await generate(
        { prompt: "p", keepAlive: "30m" },
        { fetchImpl: stub }
      );
      assert.equal(captured.keep_alive, "30m");
    });

    it("modelOverride tiene prioridad sobre env", async () => {
      let capturedBody;
      const stub = async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true, status: 200,
          json: async () => ({ response: "x" }),
          text: async () => "",
        };
      };
      await generate({ prompt: "p", model: "otro-modelo" }, { fetchImpl: stub });
      assert.equal(capturedBody.model, "otro-modelo");
    });
  });

  describe("errores tipados", () => {
    it("EMPTY_RESPONSE cuando data.response está vacío", async () => {
      const stub = mockFetchOk({ response: "" });
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) =>
          err.code === OllamaErrorCodes.EMPTY_RESPONSE &&
          err instanceof OllamaClientError
      );
    });

    it("EMPTY_RESPONSE cuando data.response no viene", async () => {
      const stub = async () => ({
        ok: true, status: 200,
        json: async () => ({ other: "field" }),
        text: async () => "",
      });
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.EMPTY_RESPONSE
      );
    });

    it("INVALID_JSON cuando res.json() falla", async () => {
      const stub = async () => ({
        ok: true, status: 200,
        json: async () => { throw new Error("boom"); },
        text: async () => "not json",
      });
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.INVALID_JSON
      );
    });

    it("MODEL_NOT_FOUND con 404 + 'not found'", async () => {
      const stub = mockFetchStatus(404, '{"error":"model \\"foo\\" not found"}');
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.MODEL_NOT_FOUND && err.httpStatus === 404
      );
    });

    it("OLLAMA_HTTP_ERROR con otros status !=2xx", async () => {
      const stub = mockFetchStatus(500, "internal");
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_HTTP_ERROR && err.httpStatus === 500
      );
    });

    it("OLLAMA_HTTP_ERROR con 404 sin 'not found' en el body", async () => {
      const stub = mockFetchStatus(404, "nope");
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_HTTP_ERROR
      );
    });

    it("OLLAMA_OFFLINE ante ECONNREFUSED (undici-style)", async () => {
      const stub = async () => {
        const cause = new Error("connect ECONNREFUSED");
        cause.code = "ECONNREFUSED";
        const err = new Error("fetch failed");
        err.cause = cause;
        throw err;
      };
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_OFFLINE
      );
    });

    it("OLLAMA_OFFLINE ante error de red genérico", async () => {
      const stub = async () => { throw new Error("boom raro"); };
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_OFFLINE
      );
    });

    it("OLLAMA_TIMEOUT cuando fetch aborta", async () => {
      const stub = async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      };
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_TIMEOUT
      );
    });

    it("timeoutMs real: si fetch tarda más que el timeout, aborta", async () => {
      // Este test verifica que AbortController se dispara y clasifica como TIMEOUT.
      const stub = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      const t0 = Date.now();
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub, timeoutMs: 25 }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_TIMEOUT
      );
      assert.ok(Date.now() - t0 < 1000, "no debería colgarse cerca del default");
    });
  });

  describe("OLLAMA_EXTRA_HEADERS", () => {
    function captureHeadersStub() {
      const captured = {};
      const stub = async (_url, init) => {
        captured.headers = init.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: "ok" }),
          text: async () => "",
        };
      };
      return { stub, captured };
    }

    it("sin la env no envía headers adicionales (comportamiento base intacto)", async () => {
      delete process.env.OLLAMA_EXTRA_HEADERS;
      const { stub, captured } = captureHeadersStub();
      await generate({ prompt: "p" }, { fetchImpl: stub });
      assert.equal(captured.headers["Content-Type"], "application/json");
      assert.equal(Object.keys(captured.headers).length, 1);
    });

    it("string vacío equivale a no setear la env", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = "   ";
      const { stub, captured } = captureHeadersStub();
      await generate({ prompt: "p" }, { fetchImpl: stub });
      assert.equal(Object.keys(captured.headers).length, 1);
      assert.equal(captured.headers["Content-Type"], "application/json");
    });

    it("envía headers válidos (CF-Access service token) junto con Content-Type", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = JSON.stringify({
        "CF-Access-Client-Id": "abc.id",
        "CF-Access-Client-Secret": "shh-secret",
      });
      const { stub, captured } = captureHeadersStub();
      await generate({ prompt: "p" }, { fetchImpl: stub });
      assert.equal(captured.headers["Content-Type"], "application/json");
      assert.equal(captured.headers["CF-Access-Client-Id"], "abc.id");
      assert.equal(captured.headers["CF-Access-Client-Secret"], "shh-secret");
    });

    it("rechaza JSON inválido con OLLAMA_CONFIG_INVALID sin exponer el contenido", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = "{not-json";
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: mockFetchOk() }),
        (err) => {
          assert.ok(err instanceof OllamaClientError);
          assert.equal(err.code, OllamaErrorCodes.OLLAMA_CONFIG_INVALID);
          assert.ok(
            !err.message.includes("{not-json"),
            "mensaje de error no debe incluir el contenido crudo"
          );
          return true;
        }
      );
    });

    it("rechaza array JSON (no es objeto plano)", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = JSON.stringify(["foo", "bar"]);
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: mockFetchOk() }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_CONFIG_INVALID
      );
    });

    it("rechaza primitivo JSON (string)", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = JSON.stringify("plain-string");
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: mockFetchOk() }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_CONFIG_INVALID
      );
    });

    it("rechaza valor no-string sin filtrarlo al mensaje", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = JSON.stringify({
        Authorization: 1234567890,
      });
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: mockFetchOk() }),
        (err) => {
          assert.equal(err.code, OllamaErrorCodes.OLLAMA_CONFIG_INVALID);
          assert.ok(
            !err.message.includes("1234567890"),
            "mensaje no debe incluir el valor crudo"
          );
          return true;
        }
      );
    });

    it("rechaza intento de sobrescribir Content-Type (case-insensitive) sin leakear el valor", async () => {
      const sneakyValue = "evil/override; charset=secret-abc123";
      process.env.OLLAMA_EXTRA_HEADERS = JSON.stringify({
        "content-type": sneakyValue,
      });
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: mockFetchOk() }),
        (err) => {
          assert.equal(err.code, OllamaErrorCodes.OLLAMA_CONFIG_INVALID);
          assert.ok(
            !err.message.includes(sneakyValue),
            "mensaje no debe incluir el valor del header rechazado"
          );
          return true;
        }
      );
    });

    it("falla rápido: no realiza la llamada HTTP si la config es inválida", async () => {
      process.env.OLLAMA_EXTRA_HEADERS = "{broken";
      let called = false;
      const stub = async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ response: "x" }), text: async () => "" };
      };
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_CONFIG_INVALID
      );
      assert.equal(called, false);
    });
  });

  describe("cancelación externa", () => {
    it("respeta signal ya abortado antes de llamar", async () => {
      const ac = new AbortController();
      ac.abort();
      const stub = (_url, init) =>
        new Promise((_r, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
          // Si el signal ya está abortado, algunos runtimes disparan sync;
          // si no, esperamos a que el ctor del cliente lo aborte.
          if (init.signal.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          }
        });
      await assert.rejects(
        () => generate({ prompt: "p" }, { fetchImpl: stub, signal: ac.signal }),
        (err) => err.code === OllamaErrorCodes.OLLAMA_TIMEOUT
      );
    });
  });
});
