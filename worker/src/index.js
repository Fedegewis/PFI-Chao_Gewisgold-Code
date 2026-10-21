// Entry point del worker local de MenteActiva.
//
// Flujo:
//  1) Cargar .env + validar config.
//  2) Adquirir lockfile para prohibir instancias duplicadas.
//  3) Instanciar logger + clientes (backend + Ollama).
//  4) Correr loop infinito; terminar en SIGINT/SIGTERM con shutdown ordenado.

import "dotenv/config";
import { loadConfig, ConfigError } from "./config.js";
import { createLogger } from "./logger.js";
import { acquireLock, SingleInstanceError } from "./singleInstance.js";
import { createBackendClient } from "./backendClient.js";
import { createOllamaClient } from "./ollamaClient.js";
import { runLoop } from "./loop.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const payload = {
      ts: new Date().toISOString(),
      level: "error",
      msg: "worker config inválida",
      meta: err instanceof ConfigError ? { field: err.field, code: err.code } : { message: err.message },
    };
    process.stdout.write(JSON.stringify(payload) + "\n");
    process.exit(2);
  }

  const logger = createLogger({ level: config.logLevel });

  // Chequeo de concurrencia local — soportamos SOLO 1 (contrato W-4).
  if (config.concurrency !== 1) {
    logger.error("WORKER_CONCURRENCY debe ser 1; abortando", { concurrency: config.concurrency });
    process.exit(2);
  }

  // Lockfile.
  let lock;
  try {
    lock = acquireLock({ lockFile: config.lockFile });
  } catch (err) {
    if (err instanceof SingleInstanceError) {
      logger.error("ya hay un worker vivo", { lock_file: err.lockFile, other_pid: err.otherPid });
      process.exit(3);
    }
    logger.error("no se pudo adquirir el lockfile", { message: err?.message });
    process.exit(3);
  }
  logger.info("worker arrancado", {
    pid: process.pid,
    backend: config.backendUrl,
    ollama: config.ollamaUrl,
    model: config.model,
    lock_file: lock.lockFile,
  });

  // Shutdown ordenado.
  const shutdown = new AbortController();
  let shutdownRequested = false;
  function requestShutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("señal de shutdown recibida", { signal });
    shutdown.abort();
  }
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  // En Windows SIGBREAK (Ctrl+Break) también desencadena shutdown.
  try { process.on("SIGBREAK", () => requestShutdown("SIGBREAK")); } catch { /* no-op */ }

  const backend = createBackendClient({ backendUrl: config.backendUrl, token: config.token });
  const ollama = createOllamaClient({
    ollamaUrl: config.ollamaUrl,
    model: config.model,
    timeoutMs: config.ollamaTimeoutMs,
  });

  let exitCode = 0;
  try {
    exitCode = await runLoop({
      backend, ollama, config, logger,
      shutdownSignal: shutdown.signal,
    });
  } catch (err) {
    logger.error("loop terminó con excepción", { message: err?.message, code: err?.code });
    exitCode = 1;
  } finally {
    try { lock.release(); } catch { /* no-op */ }
    logger.info("worker terminado", { exit_code: exitCode });
  }
  process.exit(exitCode);
}

main();
