import { Router } from "express";
import db from "../db/connection.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import defaultEmailService from "../services/emailService.js";
import { hashPassword, validateNewPassword } from "../services/passwordPolicy.js";
import {
  countActiveSessions,
  invalidatePendingLinksForUser,
  isPasswordlessEnabled,
  resolveFrontendUrl,
  revokeAllSessionsForUser,
} from "../services/patientPasswordless.js";

const router = Router();

router.get(
  "/patients",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patients = await db("users")
        .where({ role: "patient", professional_id: req.user.id, is_active: true })
        .select(
          "id",
          "role",
          "name",
          "email",
          "age",
          "professional_id",
          "is_active",
          "allow_passwordless",
          "created_at",
          "updated_at"
        )
        .orderBy("created_at", "asc");

      res.json(patients);
    } catch (err) {
      next(err);
    }
  }
);

// F1 + F2/F3 — acceso sin contraseña por paciente.
//
// `passwordless_login_available` informa si el flujo de enlaces funciona en
// este despliegue (kill switch + Resend + FRONTEND_URL). El permiso se puede
// guardar aunque no esté disponible.
//
// Reglas aplicadas en backend (no sólo en la UI):
// - D5: no se puede desactivar el último método de acceso del paciente. Hoy
//   los métodos son contraseña (password_hash) y enlace (allow_passwordless);
//   Google no aplica a pacientes. Desactivar el enlace a un paciente sin
//   contraseña → 409 last_access_method.
// - E2: desactivar el enlace revoca las sesiones persistentes del paciente y
//   anula los enlaces pendientes, en la misma transacción. Si hay sesiones
//   abiertas, el profesional debe ser informado ANTES: la primera llamada
//   responde 409 confirmation_required con la cantidad, y sólo procede con
//   `confirm_revoke_sessions: true`.

const ACCESS_ALLOWED_KEYS = ["allow_passwordless", "confirm_revoke_sessions"];

function isPasswordlessAvailable(req) {
  const emailService = req.app.locals.emailService || defaultEmailService;
  return isPasswordlessEnabled() && emailService.isConfigured() && Boolean(resolveFrontendUrl());
}

async function serializeAccess(req, patient, trx = db) {
  return {
    patient_id: patient.id,
    allow_passwordless: patient.allow_passwordless === true,
    has_password: Boolean(patient.password_hash),
    active_sessions: await countActiveSessions(patient.id, {}, trx),
    passwordless_login_available: isPasswordlessAvailable(req),
  };
}

// Ownership igual que training-config: cualquier fallo → 404 uniforme
// (no revela si el paciente existe y pertenece a otro profesional).
function parsePatientId(patientIdParam) {
  const patientId = Number(patientIdParam);
  return Number.isInteger(patientId) && patientId >= 1 ? patientId : null;
}

async function loadOwnedPatient(professionalId, patientIdParam, trx = db, { lock = false } = {}) {
  const patientId = parsePatientId(patientIdParam);
  if (!patientId) return null;
  const query = trx("users").where({ id: patientId, role: "patient", professional_id: professionalId });
  if (lock) query.forUpdate();
  return query.first();
}

router.get(
  "/patients/:id/access",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      res.json(await serializeAccess(req, patient));
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/patients/:id/access",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const body = req.body;
      if (!parsePatientId(req.params.id)) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "El cuerpo debe ser un objeto JSON" });
      }
      const unexpected = Object.keys(body).filter((k) => !ACCESS_ALLOWED_KEYS.includes(k));
      if (unexpected.length > 0) {
        return res.status(400).json({ error: `Campos no permitidos: ${unexpected.join(", ")}` });
      }
      if (typeof body.allow_passwordless !== "boolean") {
        return res.status(400).json({ error: "allow_passwordless debe ser true o false" });
      }
      if (body.confirm_revoke_sessions !== undefined && typeof body.confirm_revoke_sessions !== "boolean") {
        return res.status(400).json({ error: "confirm_revoke_sessions debe ser true o false" });
      }

      const outcome = await db.transaction(async (trx) => {
        const patient = await loadOwnedPatient(req.user.id, req.params.id, trx, { lock: true });
        if (!patient) return { status: 404, body: { error: "Paciente no encontrado" } };

        let revokedSessions = 0;
        if (body.allow_passwordless === false && patient.allow_passwordless === true) {
          // D5
          if (!patient.password_hash) {
            return {
              status: 409,
              body: {
                error: "No se puede desactivar: es el único método de acceso del paciente.",
                status: "last_access_method",
              },
            };
          }
          // E2: informar antes de revocar.
          const active = await countActiveSessions(patient.id, {}, trx);
          if (active > 0 && body.confirm_revoke_sessions !== true) {
            return {
              status: 409,
              body: {
                error: "El paciente tiene sesiones abiertas con enlace. Al desactivar el acceso se cerrarán.",
                status: "confirmation_required",
                active_sessions: active,
              },
            };
          }
          revokedSessions = await revokeAllSessionsForUser(patient.id, "passwordless_disabled", trx);
          await invalidatePendingLinksForUser(patient.id, trx);
        }

        const [updated] = await trx("users")
          .where({ id: patient.id })
          .update({ allow_passwordless: body.allow_passwordless, updated_at: trx.fn.now() })
          .returning(["id", "allow_passwordless", "password_hash"]);

        return {
          status: 200,
          body: { ...(await serializeAccess(req, updated, trx)), revoked_sessions: revokedSessions },
        };
      });

      res.status(outcome.status).json(outcome.body);
    } catch (err) {
      next(err);
    }
  }
);

// Opción A — el profesional dueño crea o reemplaza la contraseña del paciente.
// Caso de uso: el paciente entró por enlace o invitación sin contraseña y no
// tiene acceso al correo registrado (p. ej. correo inexistente). La prueba de
// titularidad la da el profesional, que es quien dio de alta al paciente.
// - Sólo el profesional dueño (404 uniforme para el resto).
// - No revoca sesiones con enlace ni cambia allow_passwordless.
// - Nunca devuelve la contraseña ni el hash.
router.put(
  "/patients/:id/password",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const body = req.body;
      if (!parsePatientId(req.params.id)) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "El cuerpo debe ser un objeto JSON" });
      }
      const unexpected = Object.keys(body).filter((k) => k !== "password");
      if (unexpected.length > 0) {
        return res.status(400).json({ error: `Campos no permitidos: ${unexpected.join(", ")}` });
      }
      const invalid = validateNewPassword(body.password);
      if (invalid) {
        return res.status(400).json({ error: invalid, status: "invalid_password" });
      }

      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      const passwordHash = await hashPassword(body.password);
      const [updated] = await db("users")
        .where({ id: patient.id })
        .update({ password_hash: passwordHash, updated_at: db.fn.now() })
        .returning(["id", "allow_passwordless", "password_hash"]);

      res.json({
        ...(await serializeAccess(req, updated)),
        password_action: patient.password_hash ? "replaced" : "created",
      });
    } catch (err) {
      next(err);
    }
  }
);

// Revoca todas las sesiones persistentes del paciente (p. ej. dispositivo
// perdido) sin cambiar el permiso. El paciente puede volver a pedir un enlace.
router.post(
  "/patients/:id/access/revoke-sessions",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      const revoked = await revokeAllSessionsForUser(patient.id, "professional_revoked");
      res.json({ ...(await serializeAccess(req, patient)), revoked_sessions: revoked });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/patients/:id",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patientId = Number(req.params.id);
      if (!Number.isInteger(patientId) || patientId < 1) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      const deleted = await db.transaction(async (trx) => {
        const patient = await trx("users")
          .where({ id: patientId, role: "patient", professional_id: req.user.id })
          .first();
        if (!patient) return null;
        await trx("sessions").where({ patient_id: patientId }).del();
        await trx("users").where({ id: patientId }).del();
        return patient;
      });

      if (!deleted) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

router.get("/users/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId < 1) {
      return res.status(400).json({ error: "ID de usuario inválido" });
    }

    const user = await db("users")
      .where("id", userId)
      .select("id", "role", "name", "email", "age", "professional_id", "is_active", "created_at", "updated_at")
      .first();

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    if (req.user.role === "professional") {
      if (user.role !== "patient" || user.professional_id !== req.user.id) {
        if (user.id !== req.user.id) {
          return res.status(404).json({ error: "Usuario no encontrado" });
        }
      }
    } else if (req.user.role === "patient") {
      if (user.id !== req.user.id) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
