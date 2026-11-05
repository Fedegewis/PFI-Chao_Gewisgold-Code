import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import db from "../db/connection.js";
import { generateToken, requireAuth, requireRole } from "../middleware/auth.js";
import defaultEmailService from "../services/emailService.js";
import {
  createSession,
  isPasswordlessEnabled,
  publicSessionPayload,
  resolveFrontendUrl as resolvePasswordlessFrontendUrl,
  setSessionCookie,
} from "../services/patientPasswordless.js";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 6;
const SALT_ROUNDS = 10;
const INVITATION_TTL_HOURS = Number(process.env.INVITATION_TTL_HOURS) || 24 * 7;

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Aceptar sin contraseña exige el flujo completo del acceso por enlace: la
// sesión inicial es una cookie (F3) y, cuando venza o se cierre, el paciente
// vuelve a entrar pidiendo un enlace a su correo (F2). Sin correo configurado
// no tendría forma de volver a entrar.
function isPasswordlessAcceptAvailable(req) {
  const emailService = req.app.locals.emailService || defaultEmailService;
  return isPasswordlessEnabled() && emailService.isConfigured() && Boolean(resolvePasswordlessFrontendUrl());
}

function deriveStatus(row, now = new Date()) {
  if (row.accepted_at) return "accepted";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "pending";
}

function serializeInvitation(row, extra = {}) {
  return {
    id: row.id,
    professional_id: row.professional_id,
    email: row.email,
    patient_name: row.patient_name,
    age: row.age ?? null,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at ?? null,
    revoked_at: row.revoked_at ?? null,
    created_at: row.created_at,
    status: deriveStatus(row),
    ...extra,
  };
}

router.post(
  "/invitations",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const { name, age, email } = req.body || {};

      if (!name || !email) {
        return res.status(400).json({ error: "name y email son obligatorios" });
      }

      const trimmedName = String(name).trim();
      if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
        return res
          .status(400)
          .json({ error: `name debe tener entre 1 y ${MAX_NAME_LENGTH} caracteres` });
      }

      const normalizedEmail = normalizeEmail(email);
      if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > MAX_EMAIL_LENGTH) {
        return res.status(400).json({ error: "Formato de email inválido" });
      }

      let parsedAge = null;
      if (age !== undefined && age !== null && age !== "") {
        parsedAge = Number(age);
        if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 150) {
          return res.status(400).json({ error: "age inválida" });
        }
      }

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600 * 1000);

      const inserted = await db.transaction(async (trx) => {
        const existingUser = await trx("users").where({ email: normalizedEmail }).first();
        if (existingUser) {
          const err = new Error("El email ya está registrado");
          err.status = 409;
          throw err;
        }

        await trx("patient_invitations")
          .where({
            professional_id: req.user.id,
            email: normalizedEmail,
          })
          .whereNull("accepted_at")
          .whereNull("revoked_at")
          .update({ revoked_at: trx.fn.now() });

        const [row] = await trx("patient_invitations")
          .insert({
            professional_id: req.user.id,
            email: normalizedEmail,
            patient_name: trimmedName,
            age: parsedAge,
            token_hash: tokenHash,
            expires_at: expiresAt,
          })
          .returning("*");

        return row;
      });

      return res.status(201).json(serializeInvitation(inserted, { token }));
    } catch (err) {
      if (err.status === 409) {
        return res.status(409).json({ error: err.message });
      }
      next(err);
    }
  }
);

router.get(
  "/invitations",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const rows = await db("patient_invitations")
        .where({ professional_id: req.user.id })
        .orderBy("created_at", "desc");

      return res.json(rows.map((row) => serializeInvitation(row)));
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/invitations/:id",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const invitationId = Number(req.params.id);
      if (!Number.isInteger(invitationId) || invitationId < 1) {
        return res.status(404).json({ error: "Invitación no encontrada" });
      }

      const revoked = await db.transaction(async (trx) => {
        const row = await trx("patient_invitations")
          .where({ id: invitationId, professional_id: req.user.id })
          .first();
        if (!row) return null;

        if (row.accepted_at || row.revoked_at) return row;

        const [updated] = await trx("patient_invitations")
          .where({ id: row.id })
          .update({ revoked_at: trx.fn.now() })
          .returning("*");
        return updated;
      });

      if (!revoked) {
        return res.status(404).json({ error: "Invitación no encontrada" });
      }

      return res.status(200).json(serializeInvitation(revoked));
    } catch (err) {
      next(err);
    }
  }
);

router.get("/invitations/lookup", async (req, res, next) => {
  try {
    const rawToken = typeof req.query.token === "string" ? req.query.token : "";
    if (!rawToken) {
      return res.status(404).json({ error: "Invitación no encontrada", status: "invalid" });
    }

    const tokenHash = hashToken(rawToken);
    const row = await db("patient_invitations")
      .join("users", "users.id", "patient_invitations.professional_id")
      .where("patient_invitations.token_hash", tokenHash)
      .select(
        "patient_invitations.email",
        "patient_invitations.patient_name",
        "patient_invitations.age",
        "patient_invitations.expires_at",
        "patient_invitations.accepted_at",
        "patient_invitations.revoked_at",
        "users.name as professional_name"
      )
      .first();

    if (!row) {
      return res.status(404).json({ error: "Invitación no encontrada", status: "invalid" });
    }

    return res.json({
      status: deriveStatus(row),
      email: row.email,
      patient_name: row.patient_name,
      age: row.age ?? null,
      expires_at: row.expires_at,
      professional_name: row.professional_name,
      passwordless_available: isPasswordlessAcceptAvailable(req),
    });
  } catch (err) {
    next(err);
  }
});

// 6F: envío de invitación por email.
// El token plaintext NO se persiste en DB (mantenemos H1/H2 hardening y el
// contrato de invitaciones). Frontend conserva el token temporal justo después
// de crearlo y lo manda a este endpoint. El backend valida contra token_hash.
// 6F guard-rail: en producción exigimos FRONTEND_URL explícita. En dev/test
// mantenemos el fallback a localhost para no romper desarrollo local ni suites.
function resolveFrontendUrl() {
  const raw = process.env.FRONTEND_URL;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") return null;
  return "http://localhost:5179";
}

function buildInviteUrl(rawToken, base) {
  return `${base}/#/invite/${rawToken}`;
}

router.post(
  "/invitations/:id/send-email",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const invitationId = Number(req.params.id);
      if (!Number.isInteger(invitationId) || invitationId < 1) {
        return res.status(404).json({ error: "Invitación no encontrada" });
      }

      const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
      if (!rawToken) {
        return res
          .status(400)
          .json({ error: "token es obligatorio", status: "invalid_token" });
      }

      const invitation = await db("patient_invitations")
        .where({ id: invitationId, professional_id: req.user.id })
        .first();
      if (!invitation) {
        // 404 uniforme: no distinguimos entre inexistente y ajena.
        return res.status(404).json({ error: "Invitación no encontrada" });
      }

      const providedHash = hashToken(rawToken);
      // timingSafeEqual sobre strings hex de igual longitud (SHA-256 → 64 chars).
      const a = Buffer.from(providedHash, "hex");
      const b = Buffer.from(invitation.token_hash, "hex");
      const tokenMatches =
        a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!tokenMatches) {
        return res
          .status(400)
          .json({ error: "Token de invitación inválido", status: "invalid_token" });
      }

      if (invitation.accepted_at) {
        return res
          .status(409)
          .json({ error: "La invitación ya fue utilizada", status: "accepted" });
      }
      if (invitation.revoked_at) {
        return res
          .status(410)
          .json({ error: "La invitación fue revocada", status: "revoked" });
      }
      if (new Date(invitation.expires_at).getTime() <= Date.now()) {
        return res
          .status(410)
          .json({ error: "La invitación expiró", status: "expired" });
      }

      const emailService = req.app.locals.emailService || defaultEmailService;

      if (!emailService.isConfigured()) {
        return res.status(503).json({
          error: "El envío de emails no está configurado",
          status: "email_not_configured",
        });
      }

      // 6F guard-rail: FRONTEND_URL obligatoria en producción.
      const frontendBase = resolveFrontendUrl();
      if (!frontendBase) {
        return res.status(503).json({
          error: "El envío de emails no está configurado",
          status: "frontend_url_not_configured",
        });
      }

      // Destinatario y nombres SIEMPRE desde DB. Frontend no puede sobreescribirlos.
      const professional = await db("users")
        .where({ id: invitation.professional_id })
        .select("name")
        .first();
      const inviteUrl = buildInviteUrl(rawToken, frontendBase);

      try {
        const result = await emailService.sendInvitationEmail({
          to: invitation.email,
          patientName: invitation.patient_name,
          professionalName: professional?.name || "Tu profesional",
          inviteUrl,
          expiresAt: invitation.expires_at,
        });
        return res.json({
          sent: true,
          ...(result && result.id ? { message_id: result.id } : {}),
        });
      } catch (err) {
        if (err?.code === "email_not_configured") {
          return res.status(503).json({
            error: "El envío de emails no está configurado",
            status: "email_not_configured",
          });
        }
        // No filtrar detalles del provider al cliente.
        return res.status(502).json({
          error: "No se pudo enviar el email",
          status: "email_provider_error",
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

router.post("/invitations/:token/accept", async (req, res, next) => {
  try {
    const rawToken = typeof req.params.token === "string" ? req.params.token : "";
    if (!rawToken) {
      return res.status(404).json({ error: "Invitación no encontrada", status: "invalid" });
    }

    // Dos modos: con contraseña (como antes) o sin contraseña
    // (`passwordless: true`): el paciente entra directo con una sesión por
    // cookie y queda habilitado para pedir enlaces a su correo.
    const { password, passwordless } = req.body || {};
    const withoutPassword = passwordless === true;
    if (withoutPassword) {
      res.set("Cache-Control", "no-store");
      res.set("Referrer-Policy", "no-referrer");
      if (!isPasswordlessAcceptAvailable(req)) {
        return res.status(503).json({
          error: "El ingreso sin contraseña no está disponible en este momento.",
          status: "passwordless_unavailable",
        });
      }
    } else {
      if (!password || typeof password !== "string") {
        return res.status(400).json({ error: "password es obligatorio", status: "invalid_password" });
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return res
          .status(400)
          .json({
            error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
            status: "invalid_password",
          });
      }
    }

    const tokenHash = hashToken(rawToken);
    const passwordHash = withoutPassword ? null : await bcrypt.hash(password, SALT_ROUNDS);

    let outcome;
    try {
      outcome = await db.transaction(async (trx) => {
        const invitation = await trx("patient_invitations")
          .where({ token_hash: tokenHash })
          .forUpdate()
          .first();

        if (!invitation) {
          return { kind: "error", status: 404, code: "invalid", message: "Invitación no encontrada" };
        }
        if (invitation.accepted_at) {
          return {
            kind: "error",
            status: 409,
            code: "accepted",
            message: "La invitación ya fue utilizada",
          };
        }
        if (invitation.revoked_at) {
          return {
            kind: "error",
            status: 410,
            code: "revoked",
            message: "La invitación fue revocada",
          };
        }
        if (new Date(invitation.expires_at).getTime() <= Date.now()) {
          return {
            kind: "error",
            status: 410,
            code: "expired",
            message: "La invitación expiró",
          };
        }

        const existingUser = await trx("users").where({ email: invitation.email }).first();
        if (existingUser) {
          return {
            kind: "error",
            status: 409,
            code: "email_taken",
            message: "El email ya está registrado",
          };
        }

        const [createdUser] = await trx("users")
          .insert({
            role: "patient",
            name: invitation.patient_name,
            email: invitation.email,
            age: invitation.age,
            professional_id: invitation.professional_id,
            password_hash: passwordHash,
            auth_provider: "local",
            is_active: true,
            // Sin contraseña, el enlace por correo es su único método de
            // acceso (D5 impide desactivarlo mientras no tenga contraseña).
            ...(withoutPassword ? { allow_passwordless: true } : {}),
          })
          .returning([
            "id",
            "role",
            "name",
            "email",
            "age",
            "professional_id",
            "is_active",
            "created_at",
          ]);

        await trx("patient_invitations")
          .where({ id: invitation.id })
          .update({
            accepted_at: trx.fn.now(),
            accepted_user_id: createdUser.id,
          });

        if (withoutPassword) {
          const { session, sessionToken } = await createSession(trx, createdUser.id);
          return { kind: "ok", user: createdUser, session, sessionToken };
        }
        return { kind: "ok", user: createdUser };
      });
    } catch (err) {
      if (err && err.code === "23505") {
        return res.status(409).json({ error: "El email ya está registrado", status: "email_taken" });
      }
      throw err;
    }

    if (outcome.kind === "error") {
      return res.status(outcome.status).json({ error: outcome.message, status: outcome.code });
    }

    if (withoutPassword) {
      setSessionCookie(res, outcome.sessionToken, outcome.session.expires_at);
      return res.status(201).json(publicSessionPayload(outcome.user, outcome.session));
    }

    const jwt = generateToken(outcome.user);
    return res.status(201).json({ user: outcome.user, token: jwt });
  } catch (err) {
    next(err);
  }
});

export default router;
