// Entry point del worker local de MenteActiva.
//
// Flujo:
//  1) Cargar .env + validar config.
//  2) Adquirir lockfile para prohibir instancias duplicadas.
//  3) Instanciar logger + clientes (backend + Ollama).
//  4) Correr loop infinito; terminar en SIGINT/SIGTERM con shutdown ordenado.

import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { loadConfig, ConfigError } from "./config.js";

// Selección explícita del archivo .env.
//   WORKER_ENV_FILE=.env.production  → carga ese archivo (prod, vía tarea programada).
//   WORKER_ENV_FILE=.env.local        → carga ese archivo (dev manual con perfil separado).
//   (unset)                           → carga .env del cwd (comportamiento legado).
// Ruta relativa se resuelve contra el cwd del proceso.
(function loadEnvFile() {
  const explicit = process.env.WORKER_ENV_FILE;
  const target = explicit && explicit.length > 0 ? explicit : ".env";
  const abs = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
  if (fs.existsSync(abs)) {
    dotenv.config({ path: abs });
  } else if (explicit) {
    // Si el usuario pidió explícitamente un archivo y no existe, fallamos ruidosamente.
    const payload = {
      ts: new Date().toISOString(),
      level: "error",
      msg: "WORKER_ENV_FILE apunta a un archivo inexistente",
      meta: { path: abs },
    };
    process.stdout.write(JSON.stringify(payload) + "\n");
    process.exit(2);
  }
  // Sin archivo y sin WORKER_ENV_FILE explícito: puede haber vars en el entorno
  // del proceso (p. ej. tarea programada con argumentos). Dejamos seguir y que
  // loadConfig valide.
})();
import { createLogger } from "./logger.js";
import { acquireLock, SingleInstanceError } from "./singleInstance.js";
import { createBackendClient } from "./backendClient.js";
import { createOllamaClient, createOllamaHealthCheck } from "./ollamaClient.js";
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

  // Shutdown cooperativo por archivo-centinela.
  // Motivación: en Windows no hay forma portable de enviar SIGINT/SIGTERM a un
  // proceso Node desde otra consola. stop-worker.ps1 crea este archivo; el
  // worker lo detecta a 1 Hz, lo elimina, y dispara el mismo shutdown que una
  // señal. El ciclo actual (incluida una inferencia activa) se completa antes
  // de salir — nunca se interrumpe trabajo en vuelo por este camino.
  const stopFlagPoller = setInterval(() => {
    try {
      if (fs.existsSync(config.stopFlagFile)) {
        try { fs.unlinkSync(config.stopFlagFile); } catch { /* no-op */ }
        clearInterval(stopFlagPoller);
        requestShutdown("STOP_FLAG");
      }
    } catch { /* no-op: ENOENT u otros errores de FS son no fatales */ }
  }, 1000);
  stopFlagPoller.unref?.();

  const backend = createBackendClient({ backendUrl: config.backendUrl, token: config.token });
  const ollama = createOllamaClient({
    ollamaUrl: config.ollamaUrl,
    model: config.model,
    timeoutMs: config.ollamaTimeoutMs,
  });
  const ollamaReady = createOllamaHealthCheck({ ollamaUrl: config.ollamaUrl, model: config.model });

  let exitCode = 0;
  try {
    exitCode = await runLoop({
      backend, ollama, ollamaReady, config, logger,
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
