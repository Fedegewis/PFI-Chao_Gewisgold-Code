// 7C: códigos de error tipados del cliente Ollama.
// Se exportan como constantes para que futuras capas (7D/7E/7G) puedan
// hacer `switch (err.code)` sin depender de strings inline.

export const OllamaErrorCodes = Object.freeze({
  OLLAMA_DISABLED: "OLLAMA_DISABLED",       // AI_ENABLED != true
  OLLAMA_OFFLINE: "OLLAMA_OFFLINE",         // ECONNREFUSED / DNS / red
  OLLAMA_TIMEOUT: "OLLAMA_TIMEOUT",         // AbortController disparó
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",       // 404 del servidor (modelo no pulled)
  OLLAMA_HTTP_ERROR: "OLLAMA_HTTP_ERROR",   // otro status != 2xx
  EMPTY_RESPONSE: "EMPTY_RESPONSE",         // 200 pero data.response vacía/ausente
  INVALID_JSON: "INVALID_JSON",             // cuerpo del servidor no es JSON parseable
  OLLAMA_CONFIG_INVALID: "OLLAMA_CONFIG_INVALID", // env de configuración malformada (ej: OLLAMA_EXTRA_HEADERS)
});

export class OllamaClientError extends Error {
  constructor(code, message, { cause, httpStatus } = {}) {
    super(message);
    this.name = "OllamaClientError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}
