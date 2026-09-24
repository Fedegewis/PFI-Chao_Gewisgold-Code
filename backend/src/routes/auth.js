import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../db/connection.js";
import { generateToken, requireAuth } from "../middleware/auth.js";

const router = Router();

const SALT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

router.post("/auth/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email y password son obligatorios" });
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `name debe tener entre 1 y ${MAX_NAME_LENGTH} caracteres` });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ error: "Formato de email inválido" });
    }
    if (normalizedEmail.length > MAX_EMAIL_LENGTH) {
      return res.status(400).json({ error: `email no puede superar ${MAX_EMAIL_LENGTH} caracteres` });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }

    const existing = await db("users").where("email", normalizedEmail).first();
    if (existing) {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [user] = await db("users")
      .insert({
        role: "professional",
        name: trimmedName,
        email: normalizedEmail,
        password_hash: passwordHash,
      })
      .returning(["id", "role", "name", "email", "is_active", "created_at"]);

    const token = generateToken(user);

    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email y password son obligatorios" });
    }

    const normalizedEmail = normalizeEmail(email);

    const user = await db("users")
      .where({ email: normalizedEmail })
      .first();

    if (!user) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        is_active: user.is_active,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
