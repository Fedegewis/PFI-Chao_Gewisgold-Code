// Loop principal del worker.
//
// Contrato (ver backend/WORKER.md):
//   - UNA sesión por vez. UNA fetch a Ollama en vuelo.
//   - Entre dos sesiones: delayBetweenSessionsMs (default 10 s).
//   - Cola vacía: idlePollMs (default 30 s).
//   - Durante inferencia activa: heartbeat cada heartbeatMs.
//   - Si el claim se pierde: abortar inferencia, no enviar resultado.
//   - FIFO lo decide el backend; el worker procesa lo que /claim devuelve.
//   - Fallos aislados no detienen el loop.
//   - SIGINT/SIGTERM: finaliza el ciclo actual con shutdown ordenado.

import { BackendErrorCodes } from "./backendClient.js";
import { OllamaErrorCodes } from "./ollamaClient.js";

async function sleep(ms, abortSignal) {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (abortSignal) {
      const onAbort = () => { clearTimeout(t); resolve(); };
      if (abortSignal.aborted) { onAbort(); return; }
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// Backoff exponencial para errores recuperables del backend. Devuelve ms.
function nextBackoffMs(attempt, maxMs) {
  const base = Math.min(15_000 * Math.pow(2, attempt - 1), maxMs);
  // jitter ±25 %
  const jitter = base * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}

/**
 * Ejecuta UN ciclo del worker (una iteración del loop):
 *  - si ctx.ollamaReady existe y Ollama no está listo: { kind: "ollama_unavailable" }
 *    sin llamar a /claim
 *  - pide /claim al backend
 *  - si no hay trabajo: devuelve { kind: "idle" }
 *  - si hay: corre Ollama con heartbeats, entrega /result o /failed
 *  - devuelve { kind: "processed" | "failed" | "lost" | "backend_error" }
 *
 * No duerme: el caller decide cuánto esperar entre ciclos.
 */
export async function runOneCycle(ctx) {
  const { backend, ollama, ollamaReady, config, logger } = ctx;

  // 0) Chequeo previo de Ollama (opcional). Si no está listo, no se
  //    reclama nada: no se toma un lease que sólo terminaría en /failed.
  //    No es garantía: Ollama puede caerse después del chequeo.
  if (ollamaReady) {
    const health = await ollamaReady();
    if (!health?.ok) {
      return { kind: "ollama_unavailable", error_code: health?.code };
    }
  }

  // 1) /claim
  let claimResp;
  try {
    claimResp = await backend.claim();
  } catch (err) {
    return { kind: "backend_error", error: err };
  }
  if (claimResp.status === 204) {
    return { kind: "idle" };
  }
  const claim = claimResp.body;
  if (!claim?.claim_id || !claim?.claim_token || !claim?.prompt) {
    logger.warn("claim payload incompleto", { body_keys: Object.keys(claim || {}) });
    return { kind: "backend_error", error: new Error("claim payload incompleto") };
  }
  logger.info("claim recibido", {
    claim_id: claim.claim_id,
    session_id: claim.session_id,
    model: claim.model,
    schema_version: claim.schema_version,
    prompt_version: claim.prompt_version,
    lease_expires_at: claim.lease_expires_at,
  });

  // 2) Correr inferencia con heartbeats concurrentes.
  const inferenceAbort = new AbortController();
  let heartbeatLost = false;

  const hbTicker = setInterval(async () => {
    try {
      await backend.heartbeat({ claimId: claim.claim_id, claimToken: claim.claim_token });
      logger.debug("heartbeat ok", { claim_id: claim.claim_id });
    } catch (err) {
      if (err?.code === BackendErrorCodes.BACKEND_CLAIM_LOST) {
        heartbeatLost = true;
        logger.warn("heartbeat: claim perdido, abortando inferencia", { claim_id: claim.claim_id });
        inferenceAbort.abort();
      } else {
        // Errores transitorios del backend durante heartbeat no cancelan
        // la inferencia; el próximo tick reintentará. El lease original
        // sigue vivo mientras no venza.
        logger.warn("heartbeat falló (no crítico)", { claim_id: claim.claim_id, code: err?.code });
      }
    }
  }, config.heartbeatMs);

  const inferenceStart = Date.now();
  let ollamaText;
  let ollamaLatency;
  let ollamaErr = null;
  try {
    const r = await ollama({
      prompt: claim.prompt,
      abortSignal: inferenceAbort.signal,
      // Desde el prompt 3.6 el backend indica num_predict/temperature.
      generationOptions: claim.generation_options,
    });
    ollamaText = r.text;
    ollamaLatency = r.latencyMs;
  } catch (err) {
    ollamaErr = err;
  } finally {
    clearInterval(hbTicker);
  }

  if (heartbeatLost) {
    logger.info("inferencia abortada por claim perdido; no se envía resultado", {
      claim_id: claim.claim_id,
      elapsed_ms: Date.now() - inferenceStart,
    });
    return { kind: "lost", claim_id: claim.claim_id };
  }

  if (ollamaErr) {
    // Reportar /failed con el error_code del whitelist. No reintenta
    // la misma sesión: el backend puede re-ofrecerla luego.
    const errorCode = ollamaErr.code && Object.values(OllamaErrorCodes).includes(ollamaErr.code)
      ? ollamaErr.code
      : OllamaErrorCodes.OLLAMA_OFFLINE;
    logger.warn("ollama falló", {
      claim_id: claim.claim_id, code: errorCode, elapsed_ms: Date.now() - inferenceStart,
    });
    try {
      await backend.failed({
        claimId: claim.claim_id,
        claimToken: claim.claim_token,
        errorCode,
        errorMessage: (ollamaErr.message || "").slice(0, 200),
        latencyMs: Date.now() - inferenceStart,
      });
    } catch (err) {
      // 409 esperable si el lease venció mientras tanto. Otros: loguear y seguir.
      if (err?.code !== BackendErrorCodes.BACKEND_CLAIM_LOST) {
        logger.warn("no se pudo reportar failed al backend", { claim_id: claim.claim_id, code: err?.code });
      }
    }
    return { kind: "failed", claim_id: claim.claim_id, error_code: errorCode };
  }

  // 3) /result. Un único envío por claim.
  try {
    await backend.result({
      claimId: claim.claim_id,
      claimToken: claim.claim_token,
      rawText: ollamaText,
      latencyMs: ollamaLatency,
    });
    logger.info("resultado persistido", { claim_id: claim.claim_id, latency_ms: ollamaLatency });
    return { kind: "processed", claim_id: claim.claim_id };
  } catch (err) {
    if (err?.code === BackendErrorCodes.BACKEND_CLAIM_LOST) {
      logger.info("claim perdido al entregar resultado", { claim_id: claim.claim_id });
      return { kind: "lost", claim_id: claim.claim_id };
    }
    if (err?.code === BackendErrorCodes.BACKEND_VALIDATION) {
      // Al responder 422 el backend ya registró el failed y cerró el claim:
      // no hay reintento con este claim ni /failed. La cola puede ofrecer un
      // claim nuevo, sujeto a MAX_GENERATION_ATTEMPTS y al cooldown.
      logger.warn("validator rechazó el resultado; el backend reprograma", {
        claim_id: claim.claim_id,
        validation_code: err.body?.validation_code,
        retriable: Boolean(err.retriable),
      });
      return { kind: "failed", claim_id: claim.claim_id, error_code: err.code };
    }
    logger.warn("backend rechazó resultado", { claim_id: claim.claim_id, code: err?.code });
    return { kind: "failed", claim_id: claim.claim_id, error_code: err?.code || "RESULT_FAILED" };
  }
}

/**
 * Loop infinito. Termina al disparar shutdownController.abort().
 */
export async function runLoop(ctx) {
  const { config, logger, shutdownSignal } = ctx;
  let backendBackoffAttempt = 0;
  let ollamaUnavailable = false;

  while (!shutdownSignal.aborted) {
    const cycle = await runOneCycle(ctx);
    if (shutdownSignal.aborted) break;

    // Sólo se loguean las transiciones de Ollama para no saturar el log.
    if (cycle.kind === "ollama_unavailable" && !ollamaUnavailable) {
      ollamaUnavailable = true;
      logger.warn("ollama no disponible; no se reclaman sesiones", { code: cycle.error_code });
    } else if (cycle.kind !== "ollama_unavailable" && ollamaUnavailable) {
      ollamaUnavailable = false;
      logger.info("ollama disponible nuevamente");
    }

    switch (cycle.kind) {
      case "ollama_unavailable":
        await sleep(config.idlePollMs, shutdownSignal);
        break;
      case "idle":
        backendBackoffAttempt = 0;
        logger.debug("cola vacía", { wait_ms: config.idlePollMs });
        await sleep(config.idlePollMs, shutdownSignal);
        break;
      case "processed":
      case "failed":
      case "lost":
        backendBackoffAttempt = 0;
        await sleep(config.delayBetweenSessionsMs, shutdownSignal);
        break;
      case "backend_error": {
        // Si fue auth, no reintentar: fatal.
        if (cycle.error?.code === BackendErrorCodes.BACKEND_AUTH) {
          logger.error("auth del worker rechazada por backend; terminando", { code: cycle.error.code });
          return 1;
        }
        backendBackoffAttempt += 1;
        const backoff = nextBackoffMs(backendBackoffAttempt, config.backendRetryMaxMs);
        logger.warn("backend inaccesible, backoff", {
          attempt: backendBackoffAttempt, wait_ms: backoff, code: cycle.error?.code,
        });
        await sleep(backoff, shutdownSignal);
        break;
      }
      default:
        logger.warn("ciclo con kind desconocido", { kind: cycle.kind });
        await sleep(config.delayBetweenSessionsMs, shutdownSignal);
    }
  }
  logger.info("loop terminado por shutdown");
  return 0;
}
