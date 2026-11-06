// Opción B — el paciente crea (o cambia) su propia contraseña estando ya
// autenticado: sesión por enlace (cookie F3 + CSRF) o JWT.
//
//   GET /api/patient/password   → { has_password }
//   PUT /api/patient/password   { password, current_password? }
//
// La titularidad de la cuenta ya está probada por la sesión abierta. Para
// CAMBIAR una contraseña existente se exige además la actual: una sesión
// robada no alcanza para reemplazarla. Si el paciente la olvidó, se la
// restablece su profesional (PUT /api/patients/:id/password).
//
// No hay ningún endpoint público que fije contraseñas a partir de un email:
// eso permitiría tomar cualquier cuenta conociendo su correo.
import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../db/connection.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { hashPassword, validateNewPassword } from "../services/passwordPolicy.js";
import { hitRateLimit } from "../services/patientPasswordless.js";

const router = Router();

const ALLOWED_KEYS = ["password", "current_password"];
// Limita intentos de adivinar la contraseña actual con una sesión abierta.
const CHANGE_RATE_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };

function noStore(res) {
  res.set("Cache-Control", "no-store");
}

router.get("/patient/password", requireAuth, requireRole("patient"), async (req, res, next) => {
  try {
    noStore(res);
    const user = await db("users").where({ id: req.user.id }).select("password_hash").first();
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ has_password: Boolean(user.password_hash) });
  } catch (err) {
    next(err);
  }
});

router.put("/patient/password", requireAuth, requireRole("patient"), async (req, res, next) => {
  try {
    noStore(res);
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "El cuerpo debe ser un objeto JSON" });
    }
    const unexpected = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
    if (unexpected.length > 0) {
      return res.status(400).json({ error: `Campos no permitidos: ${unexpected.join(", ")}` });
    }
    const invalid = validateNewPassword(body.password);
    if (invalid) {
      return res.status(400).json({ error: invalid, status: "invalid_password" });
    }

    const user = await db("users").where({ id: req.user.id }).select("id", "password_hash").first();
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    if (user.password_hash) {
      if (typeof body.current_password !== "string" || body.current_password.length === 0) {
        return res.status(400).json({
          error: "Escribí tu contraseña actual para cambiarla.",
          status: "current_password_required",
        });
      }
      const limit = await hitRateLimit("patient_password_change", String(user.id), CHANGE_RATE_LIMIT);
      if (!limit.allowed) {
        res.set("Retry-After", "900");
        return res.status(429).json({
          error: "Hiciste varios intentos seguidos. Esperá unos minutos y volvé a intentar.",
          status: "rate_limited",
        });
      }
      const valid = await bcrypt.compare(body.current_password, user.password_hash);
      if (!valid) {
        return res.status(403).json({
          error: "La contraseña actual no es correcta.",
          status: "current_password_invalid",
        });
      }
    }

    const passwordHash = await hashPassword(body.password);
    await db("users").where({ id: user.id }).update({ password_hash: passwordHash, updated_at: db.fn.now() });

    res.json({ has_password: true, password_action: user.password_hash ? "replaced" : "created" });
  } catch (err) {
    next(err);
  }
});

export default router;
