import { Router } from "express";
import crypto from "node:crypto";
import db from "../db/connection.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const INVITATION_TTL_HOURS = Number(process.env.INVITATION_TTL_HOURS) || 24 * 7;

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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

export default router;
