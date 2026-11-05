// Lectura y validación de env para el worker.
// Lee process.env en cada invocación de loadConfig(): los tests pueden
// setearlo caso por caso sin reimportar el módulo.

const MIN_TOKEN_LENGTH = 32;

export class ConfigError extends Error {
  constructor(message, { field } = {}) {
    super(message);
    this.name = "ConfigError";
    this.code = "WORKER_CONFIG_INVALID";
    if (field) this.field = field;
  }
}

function parseIntPositive(raw, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseIntNonNeg(raw, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

// Hilos de CPU para Ollama (opcional). Depende del hardware de la máquina del
// worker, por eso es configuración local y no la envía el backend. Sin valor
// válido se devuelve null y Ollama usa su propio default.
const NUM_THREAD_MAX = 64;
function parseNumThread(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n >= 1 && n <= NUM_THREAD_MAX ? n : null;
}

function stripTrailingSlash(url) {
  return typeof url === "string" ? url.replace(/\/+$/, "") : url;
}

function assertUrlAllowed(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    throw new ConfigError("WORKER_BACKEND_URL es obligatorio", { field: "WORKER_BACKEND_URL" });
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError("WORKER_BACKEND_URL no es una URL válida", { field: "WORKER_BACKEND_URL" });
  }
  // En producción se exige HTTPS. HTTP sólo se permite para localhost
  // o 127.0.0.1 durante desarrollo.
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return url;
    throw new ConfigError(
      "WORKER_BACKEND_URL con protocolo http:// sólo se permite para localhost / 127.0.0.1",
      { field: "WORKER_BACKEND_URL" }
    );
  }
  throw new ConfigError(
    `Protocolo no soportado: ${url.protocol}. Usar https:// (prod) o http://localhost (dev).`,
    { field: "WORKER_BACKEND_URL" }
  );
}

export function loadConfig(env = process.env) {
  const backendUrlRaw = stripTrailingSlash(env.WORKER_BACKEND_URL);
  assertUrlAllowed(backendUrlRaw);

  const token = env.WORKER_TOKEN;
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(
      `WORKER_TOKEN es obligatorio y debe tener ≥ ${MIN_TOKEN_LENGTH} caracteres`,
      { field: "WORKER_TOKEN" }
    );
  }

  const ollamaUrl = stripTrailingSlash(env.WORKER_OLLAMA_URL || "http://127.0.0.1:11434");

  return {
    backendUrl: backendUrlRaw,
    token,
    ollamaUrl,
    model: env.WORKER_MODEL || "llama3.2:3b",
    ollamaTimeoutMs: parseIntPositive(env.WORKER_OLLAMA_TIMEOUT_MS, 180_000),
    ollamaNumThread: parseNumThread(env.WORKER_OLLAMA_NUM_THREAD),
    concurrency: parseIntPositive(env.WORKER_CONCURRENCY, 1),
    delayBetweenSessionsMs: parseIntNonNeg(env.WORKER_DELAY_MS, 10_000),
    idlePollMs: parseIntPositive(env.WORKER_IDLE_POLL_MS, 30_000),
    heartbeatMs: parseIntPositive(env.WORKER_HEARTBEAT_MS, 60_000),
    backendRetryMaxMs: parseIntPositive(env.WORKER_BACKEND_RETRY_MAX_MS, 120_000),
    lockFile: env.WORKER_LOCK_FILE || ".worker.lock",
    // Archivo-centinela para shutdown cooperativo en Windows. El worker lo
    // observa a 1 Hz y, al detectarlo, dispara el mismo shutdown ordenado
    // que SIGINT (termina el ciclo actual, no interrumpe la inferencia).
    stopFlagFile: env.WORKER_STOP_FLAG || ".worker.stop",
    logLevel: env.WORKER_LOG_LEVEL || "info",
  };
}

export const WORKER_TOKEN_MIN_LENGTH = MIN_TOKEN_LENGTH;
