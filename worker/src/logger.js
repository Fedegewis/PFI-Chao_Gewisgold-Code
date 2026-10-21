// Logger minimalista que NUNCA imprime secretos, prompts completos ni
// respuestas del modelo. Logs van a stdout en formato JSON structured.

const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

function should(level, min) {
  return (LEVEL_ORDER[level] ?? 2) <= (LEVEL_ORDER[min] ?? 2);
}

// Elimina/trunca campos sensibles de los metadatos antes de serializar.
// - "token", "WORKER_TOKEN", "authorization" → [REDACTED]
// - "prompt", "raw_text", "summary" → se trunca a 60 chars con elipsis
// - "api_key", "password" → [REDACTED]
function sanitizeMeta(meta) {
  if (meta === null || meta === undefined) return undefined;
  if (typeof meta !== "object") return meta;
  const SENSITIVE = /^(token|worker_token|authorization|api_key|password|secret|cookie|set-cookie|credential)$/i;
  const TRUNCATABLE = /^(prompt|raw_text|summary|analysis|aspects_to_review|options_snapshot|stimulus_snapshot)$/i;
  const out = Array.isArray(meta) ? [] : {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE.test(k)) {
      out[k] = "[REDACTED]";
    } else if (TRUNCATABLE.test(k) && typeof v === "string") {
      out[k] = v.length > 60 ? `${v.slice(0, 60)}…(${v.length}b)` : `[${v.length}b string]`;
    } else if (v && typeof v === "object") {
      out[k] = sanitizeMeta(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createLogger({ level = "info", sink = (line) => process.stdout.write(line + "\n") } = {}) {
  function log(lvl, msg, meta) {
    if (!should(lvl, level)) return;
    const record = {
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...(meta !== undefined ? { meta: sanitizeMeta(meta) } : {}),
    };
    try {
      sink(JSON.stringify(record));
    } catch {
      // nunca propagamos errores de logging al pipeline
    }
  }
  return {
    error: (msg, meta) => log("error", msg, meta),
    warn: (msg, meta) => log("warn", msg, meta),
    info: (msg, meta) => log("info", msg, meta),
    debug: (msg, meta) => log("debug", msg, meta),
  };
}

export { sanitizeMeta as _sanitizeMetaForTests };
