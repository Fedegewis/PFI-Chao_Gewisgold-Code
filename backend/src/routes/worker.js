// W-1/W-2: endpoints HTTP del worker local.
//
// POST /api/worker/analysis/claim    — tomar la próxima sesión pendiente
// POST /api/worker/analysis/result   — entregar JSON de IA validable
// POST /api/worker/analysis/failed   — reportar error de inferencia
//
// Autenticación: WORKER_TOKEN (requireWorkerToken). JWT_SECRET NO se usa.
// No se expone PII ni raw outputs del modelo al cliente HTTP.

import { Router } from "express";
import { requireWorkerToken } from "../middleware/workerAuth.js";
import {
  claimNextSession,
  submitResult,
  submitFailed,
  renewLease,
  isWorkerAllowedErrorCode,
} from "../services/ai/analysisQueue.js";

const router = Router();

// POST /api/worker/analysis/claim
// Body: {} (ignorado; reservado para versiones futuras).
// 200 → { claim_id, claim_token, session_id, model, schema_version, prompt_version, lease_expires_at, prompt }
// 204 → no hay trabajo
router.post("/worker/analysis/claim", requireWorkerToken, async (_req, res, next) => {
  try {
    const payload = await claimNextSession();
    if (!payload) return res.status(204).end();
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

// POST /api/worker/analysis/result
// Body: { claim_id, claim_token, raw_text, latency_ms? }
// 200 → { ok: true, analysis_id, session_id }
// 409 → claim ya no está vigente (lease expiró o token no coincide)
// 422 → validator rechazó el output; si retriable, el worker puede reintentar
router.post("/worker/analysis/result", requireWorkerToken, async (req, res, next) => {
  try {
    const { claim_id, claim_token, raw_text, latency_ms } = req.body || {};
    try {
      const row = await submitResult({
        claimId: Number(claim_id),
        claimToken: claim_token,
        rawText: raw_text,
        latencyMs: Number.isFinite(Number(latency_ms)) ? Number(latency_ms) : null,
      });
      return res.status(200).json({
        ok: true,
        analysis_id: row.id,
        session_id: row.session_id,
      });
    } catch (err) {
      if (err?.code === "CLAIM_INVALID" || err?.code === "RESULT_INVALID") {
        return res.status(400).json({ error: "Entrada inválida", code: err.code });
      }
      if (err?.code === "CLAIM_LOST") {
        return res.status(409).json({ error: "Claim no vigente", code: err.code });
      }
      if (err?.code === "VALIDATION_FAILED") {
        return res.status(422).json({
          error: "El output del modelo no cumple el contrato",
          code: err.code,
          validation_code: err.info?.validation_code || null,
          retriable: Boolean(err.info?.retriable),
        });
      }
      return next(err);
    }
  } catch (err) {
    return next(err);
  }
});

// POST /api/worker/analysis/failed
// Body: { claim_id, claim_token, error_code, error_message?, latency_ms? }
// 200 → { ok: true, analysis_id }
// 400 → error_code no permitido
// 409 → claim ya no está vigente
router.post("/worker/analysis/failed", requireWorkerToken, async (req, res, next) => {
  try {
    const { claim_id, claim_token, error_code, error_message, latency_ms } = req.body || {};
    if (!isWorkerAllowedErrorCode(error_code)) {
      return res.status(400).json({ error: "error_code no permitido", code: "ERROR_CODE_INVALID" });
    }
    try {
      const row = await submitFailed({
        claimId: Number(claim_id),
        claimToken: claim_token,
        errorCode: error_code,
        errorMessage: error_message,
        latencyMs: Number.isFinite(Number(latency_ms)) ? Number(latency_ms) : null,
      });
      return res.status(200).json({ ok: true, analysis_id: row.id });
    } catch (err) {
      if (err?.code === "CLAIM_INVALID" || err?.code === "ERROR_CODE_INVALID") {
        return res.status(400).json({ error: "Entrada inválida", code: err.code });
      }
      if (err?.code === "CLAIM_LOST") {
        return res.status(409).json({ error: "Claim no vigente", code: err.code });
      }
      return next(err);
    }
  } catch (err) {
    return next(err);
  }
});

// POST /api/worker/analysis/heartbeat
// Body: { claim_id, claim_token }
// 200 → { ok: true, lease_expires_at }
// 400 → claim_id/claim_token inválidos (shape)
// 409 → claim no vigente (status != generating, token no coincide, o lease vencido)
router.post("/worker/analysis/heartbeat", requireWorkerToken, async (req, res, next) => {
  try {
    const { claim_id, claim_token } = req.body || {};
    try {
      const row = await renewLease({
        claimId: Number(claim_id),
        claimToken: claim_token,
      });
      return res.status(200).json({
        ok: true,
        analysis_id: row.id,
        session_id: row.session_id,
        lease_expires_at: row.lease_expires_at,
      });
    } catch (err) {
      if (err?.code === "CLAIM_INVALID") {
        return res.status(400).json({ error: "Entrada inválida", code: err.code });
      }
      if (err?.code === "CLAIM_LOST") {
        return res.status(409).json({ error: "Claim no vigente", code: err.code });
      }
      return next(err);
    }
  } catch (err) {
    return next(err);
  }
});

export default router;
