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

router.post(
  "/users",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const { name, email, age } = req.body;

      if (!name || !email) {
        return res.status(400).json({ error: "name y email son obligatorios" });
      }

      const trimmedName = String(name).trim();
      const normalizedEmail = String(email).trim().toLowerCase();

      if (!trimmedName) {
        return res.status(400).json({ error: "name no puede estar vacío" });
      }

      if (age != null) {
        const parsedAge = Number(age);
        if (!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 150) {
          return res.status(400).json({ error: "age inválida" });
        }
      }

      const existing = await db("users").where("email", normalizedEmail).first();
      if (existing) {
        return res.status(409).json({ error: "El email ya está registrado" });
      }

      const [user] = await db("users")
        .insert({
          role: "patient",
          name: trimmedName,
          email: normalizedEmail,
          age: age ?? null,
          professional_id: req.user.id,
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
          "updated_at",
        ]);

      res.status(201).json(user);
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
