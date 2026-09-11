import { Router } from "express";
import db from "../db/connection.js";

const router = Router();

router.post("/users", async (req, res, next) => {
  try {
    const { role, name, email, age, professional_id } = req.body;

    if (!role || !name || !email) {
      return res.status(400).json({ error: "role, name y email son obligatorios" });
    }

    if (role !== "patient") {
      return res.status(400).json({ error: "Solo se pueden crear pacientes por este endpoint. Los profesionales deben registrarse en /api/auth/register" });
    }

    if (professional_id != null) {
      const prof = await db("users")
        .where({ id: professional_id, role: "professional" })
        .first();
      if (!prof) {
        return res.status(404).json({ error: "Profesional no encontrado" });
      }
    }

    const existing = await db("users").where("email", email).first();
    if (existing) {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    const [user] = await db("users")
      .insert({
        role,
        name,
        email,
        age: age ?? null,
        professional_id: professional_id ?? null,
      })
      .returning(["id", "role", "name", "email", "age", "professional_id", "is_active", "created_at", "updated_at"]);

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id", async (req, res, next) => {
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

    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
