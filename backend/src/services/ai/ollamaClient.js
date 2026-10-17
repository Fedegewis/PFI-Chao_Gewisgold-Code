// 7C: cliente HTTP puro contra Ollama (/api/generate).
//
// Alcance intencionalmente MÍNIMO:
// - No arma prompts de MenteActiva (contextBuilder/promptBuilder llegan en 7D).
// - No lee ni escribe base de datos.
// - No conoce el schema de salida de IA (responseValidator llega en 7E).
// - No expone rutas (routes/analysis.js llega en 7G).
// - No persiste (session_analyses llega en 7F).
//
// Contrato del cliente:
//   generate({ prompt, model?, format?, options? }, { timeoutMs?, signal?, fetchImpl? })
//     -> { text, raw, latencyMs, model }
//     o lanza OllamaClientError con code tipado.
//
// Convenciones seguidas del proyecto:
// - ESM, `type: module`.
// - Sin logging por default (evita filtrar prompts/respuestas en logs de Render).
// - Sin SDK: fetch nativo (Node 18+ ya lo trae).
// - Config por env. `fetchImpl` inyectable EXCLUSIVAMENTE para tests unitarios.

import { OllamaClientError, OllamaErrorCodes } from "./errors.js";

const DEFAULTS = Object.freeze({
  url: "http://localhost:11434",
  model: "llama3.2:3b",
  timeoutMs: 30000,
});

// Lee env en cada llamada. Motivos:
// - Tests pueden setear process.env por caso sin necesitar reimportar el módulo.
// - Evita capturar valores stale si el server se restartea con nuevos env.
function readConfig() {
  const url = (process.env.OLLAMA_URL || DEFAULTS.url).replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULTS.model;
  const rawTimeout = process.env.OLLAMA_TIMEOUT_MS;
  const parsedTimeout = rawTimeout != null ? Number.parseInt(rawTimeout, 10) : NaN;
  const timeoutMs =
    Number.isInteger(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULTS.timeoutMs;
  const enabled = process.env.AI_ENABLED === "true";
  return { url, model, timeoutMs, enabled };
}

export function isAiEnabled() {
  return readConfig().enabled;
}

export function getOllamaConfig() {
  const { url, model, timeoutMs, enabled } = readConfig();
  return { url, model, timeoutMs, enabled };
}

// Lee OLLAMA_EXTRA_HEADERS (JSON) y valida que sea un objeto plano {string: string}.
// Permite enviar headers de autenticación hacia servidores Ollama protegidos
// (ej: Cloudflare Access service tokens: CF-Access-Client-Id / CF-Access-Client-Secret).
//
// Reglas:
// - Ausente o vacío → {} (comportamiento idéntico al previo).
// - Debe parsear a objeto JSON (no array, no null, no primitivo).
// - Claves no vacías string; valores string.
// - No puede sobrescribir "Content-Type" (comparación case-insensitive).
// - Cualquier violación → OllamaClientError(OLLAMA_CONFIG_INVALID) con mensaje
//   genérico que NO incluye el contenido crudo (puede contener credenciales).
function readExtraHeaders() {
  const raw = process.env.OLLAMA_EXTRA_HEADERS;
  if (raw === undefined || raw === null) return {};
  const trimmed = String(raw).trim();
  if (trimmed === "") return {};

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new OllamaClientError(
      OllamaErrorCodes.OLLAMA_CONFIG_INVALID,
      "OLLAMA_EXTRA_HEADERS no es JSON válido"
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OllamaClientError(
      OllamaErrorCodes.OLLAMA_CONFIG_INVALID,
      "OLLAMA_EXTRA_HEADERS debe ser un objeto JSON de pares string:string"
    );
  }

  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== "string" || key === "") {
      throw new OllamaClientError(
        OllamaErrorCodes.OLLAMA_CONFIG_INVALID,
        "OLLAMA_EXTRA_HEADERS contiene una clave inválida"
      );
    }
    if (typeof value !== "string") {
      throw new OllamaClientError(
        OllamaErrorCodes.OLLAMA_CONFIG_INVALID,
        "OLLAMA_EXTRA_HEADERS contiene un valor que no es string"
      );
    }
    if (key.toLowerCase() === "content-type") {
      throw new OllamaClientError(
        OllamaErrorCodes.OLLAMA_CONFIG_INVALID,
        "OLLAMA_EXTRA_HEADERS no puede sobrescribir Content-Type"
      );
    }
    out[key] = value;
  }
  return out;
}

// Traduce errores nativos de fetch/AbortController a códigos tipados.
// Node 18+: fetch usa undici; distintos códigos aparecen anidados en `cause`.
function classifyFetchError(err) {
  if (err && err.name === "AbortError") {
    return new OllamaClientError(
      OllamaErrorCodes.OLLAMA_TIMEOUT,
      "Ollama no respondió dentro del timeout configurado",
      { cause: err }
    );
  }
  const nestedCode = err?.cause?.code || err?.code;
  const offlineCodes = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
  ]);
  if (nestedCode && offlineCodes.has(nestedCode)) {
    return new OllamaClientError(
      OllamaErrorCodes.OLLAMA_OFFLINE,
      `No se pudo conectar con Ollama (${nestedCode})`,
      { cause: err }
    );
  }
  // Fallback: cualquier otro error de red se trata como offline; no filtramos
  // el mensaje original hacia arriba porque puede contener paths internos.
  return new OllamaClientError(
    OllamaErrorCodes.OLLAMA_OFFLINE,
    "Fallo de red al contactar con Ollama",
    { cause: err }
  );
}

export async function generate(
  { prompt, model: modelOverride, format, options, keepAlive } = {},
  { timeoutMs: timeoutOverride, signal, fetchImpl } = {}
) {
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new TypeError("prompt es obligatorio y debe ser string no vacío");
  }

  const cfg = readConfig();
  if (!cfg.enabled) {
    throw new OllamaClientError(
      OllamaErrorCodes.OLLAMA_DISABLED,
      "AI_ENABLED=false: la integración con Ollama está deshabilitada"
    );
  }

  const model = modelOverride || cfg.model;
  const timeoutMs = Number.isInteger(timeoutOverride) && timeoutOverride > 0
    ? timeoutOverride
    : cfg.timeoutMs;
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new OllamaClientError(
      OllamaErrorCodes.OLLAMA_OFFLINE,
      "fetch global no está disponible en este runtime"
    );
  }

  // Validar headers extra antes de iniciar el timer. Si está mal configurado,
  // falla rápido con OLLAMA_CONFIG_INVALID; el mensaje NO contiene el valor crudo.
  const extraHeaders = readExtraHeaders();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Si el caller pasó un signal externo (ej: request cancelada), lo enlazamos.
  let externalAbortHandler;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      externalAbortHandler = () => controller.abort();
      signal.addEventListener("abort", externalAbortHandler, { once: true });
    }
  }

  const body = {
    model,
    prompt,
    stream: false,
  };
  if (format !== undefined) body.format = format;
  if (options !== undefined) body.options = options;
  // keep_alive es un parámetro top-level de /api/generate soportado por Ollama
  // (≥0.1.9). Permite mantener el modelo residente en memoria durante ese
  // período tras la generación, reduciendo cold-start en sesiones consecutivas.
  // Se propaga sólo si el caller lo pasa explícitamente (evita cambiar el
  // comportamiento por defecto de tests que no lo esperan).
  if (keepAlive !== undefined) body.keep_alive = keepAlive;

  const startedAt = Date.now();
  let res;
  try {
    res = await doFetch(`${cfg.url}/api/generate`, {
      method: "POST",
      // Content-Type va primero y los extras se agregan después, pero
      // readExtraHeaders() ya rechazó cualquier intento de sobrescribirlo.
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw classifyFetchError(err);
  } finally {
    clearTimeout(timer);
    if (signal && externalAbortHandler) {
      signal.removeEventListener("abort", externalAbortHandler);
    }
  }

  if (!res.ok) {
    // Ollama devuelve 404 con {"error":"model '...' not found"} cuando falta el pull.
    let bodyText;
    try {
      bodyText = await res.text();
    } catch {
      bodyText = "";
    }
    const looksLikeMissingModel =
      res.status === 404 && /not found/i.test(bodyText || "");
    if (looksLikeMissingModel) {
      throw new OllamaClientError(
        OllamaErrorCodes.MODEL_NOT_FOUND,
        `Modelo '${model}' no está disponible en Ollama`,
        { httpStatus: res.status }
      );
    }
    throw new OllamaClientError(
      OllamaErrorCodes.OLLAMA_HTTP_ERROR,
      `Ollama respondió HTTP ${res.status}`,
      { httpStatus: res.status }
    );
  }

  let payload;
  try {
    payload = await res.json();
  } catch (err) {
    throw new OllamaClientError(
      OllamaErrorCodes.INVALID_JSON,
      "La respuesta de Ollama no es JSON parseable",
      { cause: err }
    );
  }

  const text = typeof payload?.response === "string" ? payload.response : "";
  if (text.length === 0) {
    throw new OllamaClientError(
      OllamaErrorCodes.EMPTY_RESPONSE,
      "Ollama devolvió una respuesta vacía"
    );
  }

  return {
    text,
    raw: payload,
    latencyMs: Date.now() - startedAt,
    model,
  };
}
