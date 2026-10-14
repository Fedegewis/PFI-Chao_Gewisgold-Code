// 7G: rutas HTTP del análisis IA.
//
// POST /api/sessions/:id/analysis           genera (o cache hit)
// GET  /api/sessions/:id/analysis           devuelve último ok
//
// Reglas:
// - Ownership 404 uniforme (patrón /results).
// - Sólo status=completed.
// - No expone raw output, prompts, contexto ni errores internos.
// - Sin rate limiting en 7G (fuera de scope).

import { Router } from "express";
import db from "../db/connection.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  generateSessionAnalysis,
  getLatestSuccessfulAnalysis,
  loadSessionAnalysisInput,
} from "../services/ai/analysisService.js";
import * as analysisRepo from "../services/ai/analysisRepository.js";
import { buildSessionAnalysisContext } from "../services/ai/contextBuilder.js";
import { buildEvidenceFromContext } from "../services/ai/evidenceBuilder.js";
import { buildObservations } from "../services/ai/observationsBuilder.js";

// 7J.2 — Umbral tras el cual una fila 'generating' se considera huérfana
// (probablemente por crash de Node antes de terminar). GET la reporta como
// last_failed en lugar de mantenerla como generating indefinidamente.
const GENERATING_STALE_MS = 3 * 60 * 1000;
import { OllamaClientError, OllamaErrorCodes } from "../services/ai/errors.js";
import {
  AnalysisValidationError,
} from "../services/ai/validationErrors.js";

const router = Router();

// Inyección de deps para tests (supertest): un test puede sobreescribir
// service.generate/get antes del request. En prod, undefined = defaults.
export const analysisRouteDeps = { generate: null, get: null };

function parseSessionIdParam(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

// Interpretación estricta de ?force= (§6): 'true' | 'false' | ausente.
function parseForceParam(raw) {
  if (raw === undefined) return { ok: true, value: false };
  if (raw === "true") return { ok: true, value: true };
  if (raw === "false") return { ok: true, value: false };
  return { ok: false };
}

async function loadOwnedCompletedSession(sessionId, professionalId) {
  const session = await db("sessions")
    .where({ id: sessionId })
    .select("id", "status", "professional_id")
    .first();
  if (!session || session.professional_id !== professionalId) {
    return { kind: "not_found" };
  }
  if (session.status !== "completed") {
    return { kind: "not_completed", status: session.status };
  }
  return { kind: "ok", session };
}

// Serialización externa: nunca expone error_message ni prompt/context/raw.
function serializeAnalysisRow(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    model: row.model,
    schema_version: row.schema_version,
    prompt_version: row.prompt_version,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
    content: row.analysis,
  };
}

function mapAiErrorToHttp(err, res) {
  if (err instanceof OllamaClientError) {
    if (err.code === OllamaErrorCodes.OLLAMA_DISABLED) {
      return res.status(503).json({
        error: "El servicio de análisis no está disponible en este momento",
        status: "ai_unavailable",
      });
    }
    // Todos los otros errores de transporte/estado del modelo.
    return res.status(502).json({
      error: "No se pudo generar el análisis",
      status: "ai_unavailable",
    });
  }
  if (err instanceof AnalysisValidationError) {
    // Exponemos el code TIPADO del validator (whitelist: INVALID_JSON,
    // SCHEMA_INVALID, UNEXPECTED_FIELD, SECTIONS_MISMATCH, EVIDENCE_INVALID)
    // para que la UI pueda explicar al profesional por qué falló esta
    // regeneración concreta. No se envía err.message (puede contener fragmento
    // del output del modelo).
    return res.status(502).json({
      error: "El modelo devolvió una respuesta que no cumple el contrato",
      status: "ai_invalid_output",
      validation_code: err.code || null,
    });
  }
  return null; // deja pasar al error handler global
}

// -----------------------------------------------------------------
// POST /api/sessions/:id/analysis
// -----------------------------------------------------------------
router.post(
  "/sessions/:id/analysis",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const sessionId = parseSessionIdParam(req.params.id);
      if (sessionId === null) {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }

      const forceParsed = parseForceParam(req.query.force);
      if (!forceParsed.ok) {
        return res.status(400).json({
          error: "El parámetro 'force' sólo acepta 'true' o 'false'",
        });
      }

      const outcome = await loadOwnedCompletedSession(sessionId, req.user.id);
      if (outcome.kind === "not_found") {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }
      if (outcome.kind === "not_completed") {
        return res.status(400).json({
          error: "El análisis solo está disponible para sesiones completadas",
        });
      }

      let result;
      try {
        result = await generateSessionAnalysis(
          { sessionId, force: forceParsed.value },
          analysisRouteDeps.generate ? { generate: analysisRouteDeps.generate } : undefined
        );
      } catch (err) {
        const mapped = mapAiErrorToHttp(err, res);
        if (mapped) return mapped;
        throw err;
      }

      const httpStatus = result.source === "cache" ? 200 : 201;
      return res.status(httpStatus).json({
        source: result.source,
        analysis: serializeAnalysisRow(result.analysis),
      });
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------------
// GET /api/sessions/:id/analysis
// -----------------------------------------------------------------
router.get(
  "/sessions/:id/analysis",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const sessionId = parseSessionIdParam(req.params.id);
      if (sessionId === null) {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }
      const outcome = await loadOwnedCompletedSession(sessionId, req.user.id);
      if (outcome.kind === "not_found") {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }
      if (outcome.kind === "not_completed") {
        return res.status(400).json({
          error: "El análisis solo está disponible para sesiones completadas",
        });
      }
      // 7J.2 — Distinguir generating/ok/failed/no_analysis.
      // Primero: si hay una fila 'ok' compatible, ganan las 'ok' aunque
      // exista una fila 'generating' posterior (regeneración manual en curso).
      const okRow = await getLatestSuccessfulAnalysis(sessionId);
      if (okRow) {
        // Si además hay una generating fresca (regeneración manual), la
        // exponemos como flag adicional para el frontend.
        const latest = await analysisRepo.getLatestAnalysisAnyStatus(db, sessionId);
        const isRegenerating =
          latest &&
          latest.status === "generating" &&
          Date.now() - new Date(latest.created_at).getTime() < GENERATING_STALE_MS;
        return res.json({
          status: "ok",
          source: "stored",
          regenerating: Boolean(isRegenerating),
          analysis: serializeAnalysisRow(okRow),
        });
      }

      const latest = await analysisRepo.getLatestAnalysisAnyStatus(db, sessionId);
      if (!latest) {
        return res.status(404).json({
          error: "No hay análisis disponible para esta sesión",
          status: "no_analysis",
        });
      }
      if (latest.status === "generating") {
        const ageMs = Date.now() - new Date(latest.created_at).getTime();
        if (ageMs >= GENERATING_STALE_MS) {
          // Fila huérfana probable — reportar como último intento fallido.
          return res.status(200).json({
            status: "last_failed",
            reason: "stalled",
          });
        }
        return res.status(202).json({
          status: "generating",
        });
      }
      // latest.status === "failed". Exponemos el error_code TIPADO (ya está
      // en la whitelist PERSISTED_ERROR_CODES) para que la UI pueda mostrar
      // la causa real al profesional sin tener que mirar logs. NO exponemos
      // error_message crudo (puede contener fragmentos del output del modelo).
      return res.status(200).json({
        status: "last_failed",
        error_code: latest.error_code || null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------------
// GET /api/sessions/:id/analysis-context  (v3.4)
//
// Devuelve el "contexto determinístico" del análisis — todo lo que el
// backend puede construir SIN depender de Ollama:
//   - activities (slug + name + cognitive_domain_slugs)
//   - evidence (session + global + section)
//   - comparison_metrics (si hay previa comparable)
//   - observations + follow_up (observationsBuilder)
//
// Permite al panel mostrar los primeros 4 bloques del informe aun
// cuando el pipeline Ollama falló o nunca se ejecutó. Mantiene las
// mismas reglas de ownership y status (sólo sesiones completed).
// NO devuelve summary ni aspects_to_review de IA — eso es exclusivo
// del endpoint /analysis.
// -----------------------------------------------------------------
router.get(
  "/sessions/:id/analysis-context",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const sessionId = parseSessionIdParam(req.params.id);
      if (sessionId === null) {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }
      const outcome = await loadOwnedCompletedSession(sessionId, req.user.id);
      if (outcome.kind === "not_found") {
        return res.status(404).json({ error: "Sesión no encontrada" });
      }
      if (outcome.kind === "not_completed") {
        return res.status(400).json({
          error: "El contexto solo está disponible para sesiones completadas",
        });
      }

      const input = await loadSessionAnalysisInput(db, sessionId);
      if (!input.global || !Array.isArray(input.sections) || input.sections.length === 0) {
        return res.status(409).json({
          error: "La sesión no tiene resultados consolidados",
          status: "no_results",
        });
      }
      const context = buildSessionAnalysisContext(input);
      const activities = context.sections.map((s) => ({
        slug: s.slug,
        name: s.name,
        cognitive_domain_slugs: Array.isArray(s.cognitive_domain_slugs)
          ? [...s.cognitive_domain_slugs]
          : [],
      }));
      const evidence = buildEvidenceFromContext(context);
      const { observations, follow_up } = buildObservations(context);

      return res.json({
        source: "deterministic",
        activities,
        evidence,
        comparison_metrics: context.comparison_metrics || null,
        observations,
        follow_up,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
