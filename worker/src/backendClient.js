// Cliente HTTP al backend MenteActiva. Envuelve los 4 endpoints del worker.
//
// - Autenticación Bearer con WORKER_TOKEN. El token NO se loggea ni se
//   expone en errores.
// - Timeout configurable por request.
// - Clasifica errores en códigos tipados (BACKEND_*) que el loop decide
//   cómo tratar (reintentar, abortar, propagar).

export const BackendErrorCodes = Object.freeze({
  BACKEND_AUTH: "BACKEND_AUTH",             // 401 / 503 worker_disabled
  BACKEND_BAD_REQUEST: "BACKEND_BAD_REQUEST", // 400
  BACKEND_CLAIM_LOST: "BACKEND_CLAIM_LOST", // 409
  BACKEND_VALIDATION: "BACKEND_VALIDATION", // 422
  BACKEND_SERVER: "BACKEND_SERVER",         // 5xx
  BACKEND_OFFLINE: "BACKEND_OFFLINE",       // red / DNS
  BACKEND_TIMEOUT: "BACKEND_TIMEOUT",       // AbortController
  BACKEND_UNEXPECTED: "BACKEND_UNEXPECTED", // otros
});

export class BackendError extends Error {
  constructor(code, message, { httpStatus, body, retriable } = {}) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
    if (body !== undefined) this.body = body;
    if (retriable !== undefined) this.retriable = retriable;
  }
}

function classifyFetchError(err) {
  if (err?.name === "AbortError") {
    return new BackendError(
      BackendErrorCodes.BACKEND_TIMEOUT,
      "Timeout contactando al backend",
      { retriable: true }
    );
  }
  const nestedCode = err?.cause?.code || err?.code;
  const offline = new Set([
    "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET",
    "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
  ]);
  if (nestedCode && offline.has(nestedCode)) {
    return new BackendError(
      BackendErrorCodes.BACKEND_OFFLINE,
      `Backend inaccesible (${nestedCode})`,
      { retriable: true }
    );
  }
  return new BackendError(
    BackendErrorCodes.BACKEND_OFFLINE,
    "Fallo de red al contactar al backend",
    { retriable: true }
  );
}

/**
 * Factory del cliente. fetchImpl inyectable sólo para tests.
 */
export function createBackendClient({
  backendUrl,
  token,
  timeoutMs = 30_000,
  fetchImpl,
} = {}) {
  if (typeof backendUrl !== "string" || backendUrl.length === 0) {
    throw new TypeError("backendUrl requerido");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("token requerido");
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const base = backendUrl.replace(/\/+$/, "");

  async function request(pathSuffix, { body, timeoutMsOverride } = {}) {
    const controller = new AbortController();
    const t = Number.isInteger(timeoutMsOverride) && timeoutMsOverride > 0 ? timeoutMsOverride : timeoutMs;
    const timer = setTimeout(() => controller.abort(), t);
    let res;
    try {
      res = await doFetch(`${base}${pathSuffix}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body === undefined ? "{}" : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw classifyFetchError(err);
    } finally {
      clearTimeout(timer);
    }

    // Clasificar por status.
    const status = res.status;
    let parsedBody = null;
    try {
      const text = await res.text();
      parsedBody = text.length > 0 ? JSON.parse(text) : null;
    } catch { /* no es JSON: dejar null */ }

    if (status === 204) return { status: 204, body: null };
    if (status >= 200 && status < 300) return { status, body: parsedBody };

    if (status === 401 || status === 503) {
      throw new BackendError(
        BackendErrorCodes.BACKEND_AUTH,
        "Backend rechazó la autenticación o worker deshabilitado",
        { httpStatus: status, body: parsedBody, retriable: false }
      );
    }
    if (status === 400) {
      throw new BackendError(
        BackendErrorCodes.BACKEND_BAD_REQUEST,
        "Backend rechazó la request (400)",
        { httpStatus: status, body: parsedBody, retriable: false }
      );
    }
    if (status === 409) {
      throw new BackendError(
        BackendErrorCodes.BACKEND_CLAIM_LOST,
        "Claim no vigente",
        { httpStatus: status, body: parsedBody, retriable: false }
      );
    }
    if (status === 422) {
      throw new BackendError(
        BackendErrorCodes.BACKEND_VALIDATION,
        "Validator rechazó la respuesta del modelo",
        { httpStatus: status, body: parsedBody, retriable: Boolean(parsedBody?.retriable) }
      );
    }
    if (status >= 500) {
      throw new BackendError(
        BackendErrorCodes.BACKEND_SERVER,
        `Backend respondió HTTP ${status}`,
        { httpStatus: status, body: parsedBody, retriable: true }
      );
    }
    throw new BackendError(
      BackendErrorCodes.BACKEND_UNEXPECTED,
      `Backend respondió HTTP ${status} (inesperado)`,
      { httpStatus: status, body: parsedBody, retriable: false }
    );
  }

  return {
    async claim() { return request("/api/worker/analysis/claim"); },
    async heartbeat({ claimId, claimToken }) {
      return request("/api/worker/analysis/heartbeat", {
        body: { claim_id: claimId, claim_token: claimToken },
      });
    },
    async result({ claimId, claimToken, rawText, latencyMs }) {
      return request("/api/worker/analysis/result", {
        body: {
          claim_id: claimId,
          claim_token: claimToken,
          raw_text: rawText,
          ...(latencyMs !== undefined ? { latency_ms: latencyMs } : {}),
        },
      });
    },
    async failed({ claimId, claimToken, errorCode, errorMessage, latencyMs }) {
      return request("/api/worker/analysis/failed", {
        body: {
          claim_id: claimId,
          claim_token: claimToken,
          error_code: errorCode,
          ...(errorMessage !== undefined ? { error_message: errorMessage } : {}),
          ...(latencyMs !== undefined ? { latency_ms: latencyMs } : {}),
        },
      });
    },
  };
}
