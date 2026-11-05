// Cliente HTTP mínimo contra Ollama local (/api/generate).
// Mapea errores a los OLLAMA_* del whitelist aceptado por /failed.

export const OllamaErrorCodes = Object.freeze({
  OLLAMA_OFFLINE: "OLLAMA_OFFLINE",
  OLLAMA_TIMEOUT: "OLLAMA_TIMEOUT",
  OLLAMA_HTTP_ERROR: "OLLAMA_HTTP_ERROR",
  OLLAMA_MODEL_NOT_FOUND: "OLLAMA_MODEL_NOT_FOUND",
  OLLAMA_EMPTY_RESPONSE: "OLLAMA_EMPTY_RESPONSE",
  OLLAMA_INVALID_JSON: "OLLAMA_INVALID_JSON",
  OLLAMA_CONFIG_INVALID: "OLLAMA_CONFIG_INVALID",
});

export class OllamaError extends Error {
  constructor(code, message, { httpStatus, cause } = {}) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
    if (cause !== undefined) this.cause = cause;
  }
}

function classify(err) {
  if (err?.name === "AbortError") {
    return new OllamaError(OllamaErrorCodes.OLLAMA_TIMEOUT, "Ollama no respondió dentro del timeout");
  }
  const code = err?.cause?.code || err?.code;
  const offline = new Set([
    "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET",
    "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
  ]);
  if (code && offline.has(code)) {
    return new OllamaError(OllamaErrorCodes.OLLAMA_OFFLINE, `Ollama inaccesible (${code})`);
  }
  return new OllamaError(OllamaErrorCodes.OLLAMA_OFFLINE, "Fallo de red al contactar con Ollama");
}

/**
 * Chequeo liviano previo al /claim: GET /api/tags y presencia del modelo.
 * Nunca lanza; devuelve { ok: true } o { ok: false, code }.
 * Es una foto del momento: Ollama puede caerse entre este chequeo y la
 * inferencia, y ese caso sigue cubierto por el /failed del ciclo.
 */
export function createOllamaHealthCheck({ ollamaUrl, model, timeoutMs = 5_000, fetchImpl } = {}) {
  if (typeof ollamaUrl !== "string" || ollamaUrl.length === 0) {
    throw new TypeError("ollamaUrl requerido");
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new TypeError("model requerido");
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const base = ollamaUrl.replace(/\/+$/, "");

  return async function checkReady() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${base}/api/tags`, { method: "GET", signal: controller.signal });
    } catch (err) {
      return { ok: false, code: classify(err).code };
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { ok: false, code: OllamaErrorCodes.OLLAMA_HTTP_ERROR };
    }
    let payload;
    try {
      payload = await res.json();
    } catch {
      return { ok: false, code: OllamaErrorCodes.OLLAMA_INVALID_JSON };
    }
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const present = models.some((m) => m?.name === model || m?.model === model);
    return present ? { ok: true } : { ok: false, code: OllamaErrorCodes.OLLAMA_MODEL_NOT_FOUND };
  };
}

// Parámetros de inferencia por defecto (contrato ≤3.5).
export const DEFAULT_GENERATION_OPTIONS = Object.freeze({ temperature: 0.2, num_predict: 300 });

// Cotas para los parámetros que el backend envía en el claim
// (generation_options, desde el prompt 3.6). Sólo se aceptan estas dos
// claves y dentro de rangos razonables; cualquier otra cosa se ignora.
const NUM_PREDICT_MAX = 2048;

// 3.6 (ajuste): el backend puede enviar en generation_options.format el JSON
// Schema de la salida (structured outputs de Ollama). Se acepta sólo un
// objeto JSON de tamaño acotado con type "object"; cualquier otra cosa cae
// a "json". El backend valida la respuesta igual, con o sin schema.
const FORMAT_SCHEMA_MAX_BYTES = 8192;

export function resolveOutputFormat(override) {
  const f = override && typeof override === "object" ? override.format : undefined;
  if (!f || typeof f !== "object" || Array.isArray(f) || f.type !== "object") return "json";
  let size;
  try { size = JSON.stringify(f).length; } catch { return "json"; }
  return size <= FORMAT_SCHEMA_MAX_BYTES ? f : "json";
}

export function resolveGenerationOptions(override) {
  const out = { ...DEFAULT_GENERATION_OPTIONS };
  if (!override || typeof override !== "object") return out;
  const np = override.num_predict;
  if (Number.isInteger(np) && np >= 1 && np <= NUM_PREDICT_MAX) out.num_predict = np;
  const t = override.temperature;
  if (typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= 1) out.temperature = t;
  return out;
}

/**
 * Factory. fetchImpl y signal inyectables para tests y para cancelación
 * externa (cuando el claim se pierde mid-inferencia).
 */
export function createOllamaClient({ ollamaUrl, model, timeoutMs = 180_000, fetchImpl } = {}) {
  if (typeof ollamaUrl !== "string" || ollamaUrl.length === 0) {
    throw new TypeError("ollamaUrl requerido");
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new TypeError("model requerido");
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const base = ollamaUrl.replace(/\/+$/, "");

  return async function generate({ prompt, abortSignal, generationOptions } = {}) {
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new TypeError("prompt requerido");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let externalHandler;
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timer);
        controller.abort();
      } else {
        externalHandler = () => controller.abort();
        abortSignal.addEventListener("abort", externalHandler, { once: true });
      }
    }

    const started = Date.now();
    let res;
    try {
      res = await doFetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: resolveOutputFormat(generationOptions),
          options: resolveGenerationOptions(generationOptions),
          keep_alive: "30m",
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw classify(err);
    } finally {
      clearTimeout(timer);
      if (abortSignal && externalHandler) {
        abortSignal.removeEventListener("abort", externalHandler);
      }
    }

    if (!res.ok) {
      let text = "";
      try { text = await res.text(); } catch { /* no-op */ }
      if (res.status === 404 && /not found/i.test(text)) {
        throw new OllamaError(
          OllamaErrorCodes.OLLAMA_MODEL_NOT_FOUND,
          `Modelo '${model}' no está pullado`,
          { httpStatus: res.status }
        );
      }
      throw new OllamaError(
        OllamaErrorCodes.OLLAMA_HTTP_ERROR,
        `Ollama respondió HTTP ${res.status}`,
        { httpStatus: res.status }
      );
    }

    let payload;
    try {
      payload = await res.json();
    } catch (err) {
      throw new OllamaError(OllamaErrorCodes.OLLAMA_INVALID_JSON, "Respuesta de Ollama no parseable", { cause: err });
    }
    const text = typeof payload?.response === "string" ? payload.response : "";
    if (text.length === 0) {
      throw new OllamaError(OllamaErrorCodes.OLLAMA_EMPTY_RESPONSE, "Ollama devolvió respuesta vacía");
    }
    return { text, latencyMs: Date.now() - started };
  };
}
