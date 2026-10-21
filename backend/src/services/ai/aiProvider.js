// W-3: fábrica de proveedor de inferencia IA.
//
// Lee AI_PROVIDER en cada invocación para que:
// - los tests puedan setear process.env por caso sin reimportar;
// - un rebind de env entre requests no quede capturado "stale".
//
// Semántica:
//   AI_PROVIDER ausente / "ollama" → cliente Ollama (default, dev local).
//   AI_PROVIDER = "deferred"       → NO se corre inferencia en el backend.
//                                     La sesión queda disponible para que
//                                     el worker local (ver W-2+) la reclame
//                                     via /api/worker/analysis/*. El pipeline
//                                     in-process NUNCA llama a Ollama ni
//                                     persiste una fila 'generating' propia.
//   Cualquier otro valor           → Error explícito (sin fallback silencioso).
//
// AI_ENABLED mantiene su rol de interruptor general; cada cliente también
// lo chequea internamente y lanza su propio *_DISABLED cuando corresponde.
//
// Groq NO está incluido en esta rama (quedó en feature/groq-cloud-inference).

import {
  generate as ollamaGenerate,
  getOllamaConfig,
} from "./ollamaClient.js";

const ALLOWED_PROVIDERS = Object.freeze(["ollama", "deferred"]);

// Error específico del modo deferred. El pipeline in-process se niega a
// invocarse: la sesión queda esperando al worker local. No se persiste
// una fila `generating` ni `failed`; el worker la descubrirá en su próximo
// claim via la query de la cola (analysisQueue.findNextPendingSessionId).
export class AiDeferredError extends Error {
  constructor() {
    super("AI_PROVIDER=deferred: la inferencia se delega al worker local");
    this.name = "AiDeferredError";
    this.code = "AI_DEFERRED";
  }
}

function deferredGenerate() {
  throw new AiDeferredError();
}

function getDeferredConfig() {
  // Modelo "actual" de la triple de cache / cola. Debe coincidir con el
  // que el worker usa en Ollama local — por eso compartimos la misma
  // resolución que analysisQueue (WORKER_MODEL o fallback a OLLAMA_MODEL).
  const model = process.env.WORKER_MODEL || process.env.OLLAMA_MODEL || "llama3.2:3b";
  return {
    model,
    timeoutMs: 0, // n/a, no se llama inferencia desde el backend
    enabled: process.env.AI_ENABLED === "true",
    deferred: true,
  };
}

function readProviderName() {
  const raw = process.env.AI_PROVIDER;
  if (raw === undefined || raw === null || raw === "") return "ollama";
  if (!ALLOWED_PROVIDERS.includes(raw)) {
    throw new Error(
      `AI_PROVIDER inválido: '${raw}' (válidos: ${ALLOWED_PROVIDERS.join(", ")})`
    );
  }
  return raw;
}

/**
 * Devuelve el proveedor seleccionado. Un provider es:
 *   {
 *     name: "ollama"|"deferred",
 *     generate(args, opts)       -> { text, raw, latencyMs, model } o AiDeferredError
 *     getConfig()                -> { model, timeoutMs, enabled, deferred? }
 *     errorFamily: "ollama"      -- "deferred" no persiste errors propios
 *     deferred: boolean
 *   }
 */
export function getAiProvider() {
  const name = readProviderName();
  if (name === "deferred") {
    return {
      name: "deferred",
      generate: deferredGenerate,
      getConfig: getDeferredConfig,
      errorFamily: "ollama", // n/a: deferred no persiste errores propios
      deferred: true,
    };
  }
  // name === "ollama"
  return {
    name: "ollama",
    generate: ollamaGenerate,
    getConfig: getOllamaConfig,
    errorFamily: "ollama",
    deferred: false,
  };
}

export function generate(args, opts) {
  return getAiProvider().generate(args, opts);
}

export function getConfig() {
  return getAiProvider().getConfig();
}

export function getErrorFamily() {
  return getAiProvider().errorFamily;
}

/**
 * true cuando el modo delega al worker local y el pipeline in-process
 * debe abstenerse de intentar inferencia.
 */
export function isDeferred() {
  return getAiProvider().name === "deferred";
}

/**
 * Interruptor general de IA (independiente del proveedor seleccionado).
 */
export function isAiEnabled() {
  return process.env.AI_ENABLED === "true";
}

export const AI_PROVIDERS = ALLOWED_PROVIDERS;
