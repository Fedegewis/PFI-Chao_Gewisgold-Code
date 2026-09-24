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
