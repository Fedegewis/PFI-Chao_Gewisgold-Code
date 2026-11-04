import jwt from "jsonwebtoken";
import db from "../db/connection.js";
import { authenticateSessionCookie, clearSessionCookie, hasSessionCookie } from "../services/patientPasswordless.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET no está definido. Configuralo en el archivo .env antes de iniciar el servidor.");
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    // F3: sin Bearer, se intenta la sesión persistente de paciente (cookie
    // HttpOnly). Con Bearer, el comportamiento es exactamente el anterior.
    if (hasSessionCookie(req)) {
      try {
        const result = await authenticateSessionCookie(req);
        if (!result.ok) {
          if (result.clearCookie) clearSessionCookie(res);
          return res.status(result.status).json(result.body);
        }
        req.user = result.user;
        req.auth = { method: "patient_session", sessionId: result.session.id };
        return next();
      } catch (err) {
        return next(err);
      }
    }
    return res.status(401).json({ error: "Token de autenticación requerido" });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  const user = await db("users")
    .where({ id: payload.id, is_active: true })
    .select("id", "role", "name", "email")
    .first();

  if (!user) {
    return res.status(401).json({ error: "Usuario no encontrado o inactivo" });
  }

  req.user = user;
  req.auth = { method: "jwt" };
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Token de autenticación requerido" });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: "No tenés permisos para esta acción" });
    }
    next();
  };
}
