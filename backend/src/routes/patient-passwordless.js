// F2 + F3 — endpoints públicos del acceso sin contraseña de pacientes.
//
//   GET  /api/auth/passwordless/config        ¿está disponible el flujo?
//   POST /api/auth/patient-link/request       pedir enlace (respuesta genérica)
//   POST /api/auth/patient-link/consume       canjear enlace → cookie de sesión
//   GET  /api/auth/patient-session            restaurar sesión (y rotar token)
//   POST /api/auth/patient-session/logout     cerrar esta sesión (CSRF)
//   POST /api/auth/patient-session/logout-all cerrar todas las sesiones (CSRF)
//
// Ninguna respuesta ni log incluye tokens ni enlaces. La respuesta de
// /request es idéntica exista o no el correo, esté o no habilitado.
import { Router } from "express";
import defaultEmailService from "../services/emailService.js";
import {
  LOGIN_LINK_TTL_MS,
  authenticateSessionCookie,
  buildLoginLinkUrl,
  clearSessionCookie,
  consumeLoginLink,
  findActiveSession,
  hasSessionCookie,
  hitRateLimit,
  invalidateLoginLink,
  isPasswordlessEnabled,
  issueLoginLink,
  maybeRotateSession,
  normalizeEmail,
  publicSessionPayload,
  purgeOldRateLimits,
  rateLimitConfig,
  readSessionCookie,
  resolveFrontendUrl,
  revokeAllSessionsForUser,
  revokeSession,
  setSessionCookie,
} from "../services/patientPasswordless.js";

const router = Router();

const GENERIC_REQUEST_MESSAGE =
  "Si el correo corresponde a una cuenta habilitada, te enviamos un enlace para ingresar.";
const RATE_LIMITED_MESSAGE =
  "Hiciste varios pedidos seguidos. Esperá unos minutos y volvé a intentar.";
const INVALID_LINK_MESSAGE = "El enlace venció o ya fue utilizado.";

function noStore(res) {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
}

function emailServiceFor(req) {
  return req.app.locals.emailService || defaultEmailService;
}

function isFlowAvailable(req) {
  return isPasswordlessEnabled() && emailServiceFor(req).isConfigured() && Boolean(resolveFrontendUrl());
}

function disabledResponse(res) {
  return res.status(503).json({
    error: "El ingreso con enlace no está disponible en este momento.",
    status: "passwordless_unavailable",
  });
}

function logEvent(event, extra = {}) {
  // Sólo códigos: nunca email, token, enlace ni id de enlace.
  if (process.env.NODE_ENV === "test") return;
  console.info(`[patient-passwordless] ${event}`, extra);
}

router.get("/auth/passwordless/config", (req, res) => {
  noStore(res);
  res.json({ enabled: isFlowAvailable(req) });
});

// Trabajo posterior a la respuesta: búsqueda del paciente, emisión del enlace
// y envío. Hacerlo DESPUÉS de responder hace que el tiempo de respuesta no
// dependa de si el correo existe (evita enumeración por timing).
async function deliverLoginLink(emailService, normalizedEmail) {
  try {
    await purgeOldRateLimits().catch(() => {});
    const issued = await issueLoginLink(normalizedEmail);
    if (!issued) {
      logEvent("request_ignored");
      return { sent: false };
    }
    const base = resolveFrontendUrl();
    try {
      await emailService.sendPatientLoginLinkEmail({
        to: issued.user.email,
        patientName: issued.user.name,
        loginUrl: buildLoginLinkUrl(issued.token, base),
        ttlMinutes: LOGIN_LINK_TTL_MS / 60000,
      });
      logEvent("link_sent");
      return { sent: true };
    } catch (err) {
      // El enlace no llegó a nadie: se invalida para no dejar un token vivo.
      await invalidateLoginLink(issued.linkId).catch(() => {});
      logEvent("email_failed", { code: err?.code || "unknown" });
      return { sent: false, error: err?.code || "unknown" };
    }
  } catch (err) {
    logEvent("delivery_error", { code: err?.code || "unknown" });
    return { sent: false, error: "internal" };
  }
}

router.post("/auth/patient-link/request", async (req, res, next) => {
  try {
    noStore(res);
    if (!isFlowAvailable(req)) return disabledResponse(res);

    const normalizedEmail = normalizeEmail(req.body?.email);
    if (!normalizedEmail) {
      return res.status(400).json({ error: "Escribí un correo electrónico válido.", status: "invalid_email" });
    }

    // Los contadores se incrementan siempre (exista o no el correo): el 429
    // no revela nada sobre la cuenta.
    const limits = rateLimitConfig();
    const ip = req.ip || "unknown";
    const [ipShort, emailShort, emailDaily] = await Promise.all([
      hitRateLimit("link_request_ip", ip, limits.ipShort),
      hitRateLimit("link_request_email", normalizedEmail, limits.emailShort),
      hitRateLimit("link_request_email_day", normalizedEmail, limits.emailDaily),
    ]);
    if (!ipShort.allowed || !emailShort.allowed || !emailDaily.allowed) {
      res.set("Retry-After", "900");
      return res.status(429).json({ error: RATE_LIMITED_MESSAGE, status: "rate_limited" });
    }

    res.status(202).json({ ok: true, message: GENERIC_REQUEST_MESSAGE });

    const task = deliverLoginLink(emailServiceFor(req), normalizedEmail);
    const hook = req.app.locals.onPasswordlessTask;
    if (typeof hook === "function") hook(task);
  } catch (err) {
    next(err);
  }
});

router.post("/auth/patient-link/consume", async (req, res, next) => {
  try {
    noStore(res);
    if (!isPasswordlessEnabled()) return disabledResponse(res);

    const limits = rateLimitConfig();
    const ipLimit = await hitRateLimit("link_consume_ip", req.ip || "unknown", limits.consumeIp);
    if (!ipLimit.allowed) {
      res.set("Retry-After", "900");
      return res.status(429).json({ error: RATE_LIMITED_MESSAGE, status: "rate_limited" });
    }

    const outcome = await consumeLoginLink(req.body?.token);
    if (!outcome) {
      logEvent("consume_rejected");
      return res.status(410).json({ error: INVALID_LINK_MESSAGE, status: "invalid_link" });
    }

    setSessionCookie(res, outcome.sessionToken, outcome.session.expires_at);
    logEvent("session_created");
    return res.status(200).json(publicSessionPayload(outcome.user, outcome.session));
  } catch (err) {
    next(err);
  }
});

router.get("/auth/patient-session", async (req, res, next) => {
  try {
    noStore(res);
    if (!isPasswordlessEnabled()) {
      return res.status(401).json({ error: "Sesión no válida", status: "session_invalid" });
    }
    const token = readSessionCookie(req);
    const session = token ? await findActiveSession(token) : null;
    if (!session) {
      if (hasSessionCookie(req)) clearSessionCookie(res);
      return res.status(401).json({ error: "Sesión no válida", status: "session_invalid" });
    }
    const rotated = await maybeRotateSession(session);
    if (rotated) setSessionCookie(res, rotated, session.expires_at);
    const user = { id: session.user_id, role: session.role, name: session.name, email: session.email };
    return res.json(publicSessionPayload(user, session));
  } catch (err) {
    next(err);
  }
});

async function requireCookieSession(req, res) {
  const result = await authenticateSessionCookie(req);
  if (!result.ok) {
    if (result.clearCookie) clearSessionCookie(res);
    res.status(result.status).json(result.body);
    return null;
  }
  return result;
}

router.post("/auth/patient-session/logout", async (req, res, next) => {
  try {
    noStore(res);
    // Sin cookie válida no hay nada que revocar; igual se limpia la cookie.
    if (!readSessionCookie(req)) {
      clearSessionCookie(res);
      return res.status(204).send();
    }
    const auth = await requireCookieSession(req, res);
    if (!auth) return undefined;
    await revokeSession(auth.session.id, "logout");
    clearSessionCookie(res);
    logEvent("logout");
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/auth/patient-session/logout-all", async (req, res, next) => {
  try {
    noStore(res);
    const auth = await requireCookieSession(req, res);
    if (!auth) return undefined;
    const revoked = await revokeAllSessionsForUser(auth.user.id, "logout_all");
    clearSessionCookie(res);
    logEvent("logout_all", { revoked });
    return res.json({ revoked_sessions: revoked });
  } catch (err) {
    next(err);
  }
});

export default router;
