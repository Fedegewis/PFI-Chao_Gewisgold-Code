import { Router } from "express";
import db from "../db/connection.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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

// F1 — permiso de acceso sin contraseña por paciente.
//
// El flujo de enlaces por correo todavía no existe (F2). Mientras tanto el
// permiso se puede guardar, pero NO habilita ningún método de autenticación:
// `passwordless_login_available=false` le indica al frontend que lo presente
// como "Próximamente". F2 cambiará esta constante cuando el flujo funcione.
export const PASSWORDLESS_LOGIN_AVAILABLE = false;

const ACCESS_ALLOWED_KEYS = ["allow_passwordless"];

function serializeAccess(patient) {
  return {
    patient_id: patient.id,
    allow_passwordless: patient.allow_passwordless === true,
    passwordless_login_available: PASSWORDLESS_LOGIN_AVAILABLE,
  };
}

// Ownership igual que training-config: cualquier fallo → 404 uniforme
// (no revela si el paciente existe y pertenece a otro profesional).
async function loadOwnedPatient(professionalId, patientIdParam) {
  const patientId = Number(patientIdParam);
  if (!Number.isInteger(patientId) || patientId < 1) return null;
  return db("users")
    .where({ id: patientId, role: "patient", professional_id: professionalId })
    .first();
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
      res.json(serializeAccess(patient));
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
      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      const body = req.body;
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

      const [updated] = await db("users")
        .where({ id: patient.id })
        .update({ allow_passwordless: body.allow_passwordless, updated_at: db.fn.now() })
        .returning(["id", "allow_passwordless"]);

      res.json(serializeAccess(updated));
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
