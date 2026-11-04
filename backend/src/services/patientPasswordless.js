// F2 + F3 — acceso sin contraseña para pacientes y sesiones persistentes.
//
// Diseño (resumen; detalle en backend/docs/patient-passwordless-auth.md):
//
// - Enlace de acceso: token aleatorio de 32 bytes (base64url, 43 chars) que
//   viaja SOLO en el correo, dentro del fragmento de la URL
//   (`/#/enlace/<token>`). El fragmento nunca se envía al servidor en la
//   navegación ni en el Referer; el frontend lo saca de la URL y lo manda al
//   backend en el BODY de un POST. En la DB se guarda sólo SHA-256(token).
//   Vence a los 30 minutos y es de un solo uso (UPDATE condicional atómico).
//
// - Sesión persistente: otro token aleatorio de 32 bytes en una cookie
//   HttpOnly + SameSite=Strict (+ Secure y prefijo __Host- en producción),
//   Path=/ y sin Domain. En la DB se guarda SHA-256(token). Vencimiento
//   absoluto de 30 días (la rotación NO lo extiende). El token se rota cada
//   24 h al restaurar la sesión; el hash anterior se acepta durante 2 minutos.
//
// - CSRF: toda operación con método no seguro autenticada por cookie exige el
//   header X-CSRF-Token = HMAC(clave del servidor, id de sesión). El frontend
//   lo recibe en el body de consume / restore y lo guarda sólo en memoria.
//   Un sitio ajeno no puede leerlo (CORS) ni calcularlo (HMAC con secreto).
//
// - Kill switch: PATIENT_PASSWORDLESS_ENABLED !== "true" desactiva TODO el
//   flujo (pedido de enlaces, consumo y autenticación por cookie). Los métodos
//   tradicionales (JWT por contraseña, Google) no dependen de este módulo.

import crypto from "node:crypto";
import db from "../db/connection.js";

export const LOGIN_LINK_TTL_MS = 30 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const PREVIOUS_TOKEN_GRACE_MS = 2 * 60 * 1000;
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export const CSRF_HEADER = "x-csrf-token";
const COOKIE_BASE_NAME = "ma_patient_session";
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// ---------------------------------------------------------------------------
// Configuración (leída en cada uso para que tests y rollback por env funcionen)
// ---------------------------------------------------------------------------

export function isPasswordlessEnabled() {
  return process.env.PATIENT_PASSWORDLESS_ENABLED === "true";
}

export function isCookieSecure() {
  const raw = process.env.AUTH_COOKIE_SECURE;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

// __Host- exige Secure, Path=/ y ausencia de Domain. Sólo se usa con Secure:
// en desarrollo local por http el navegador rechazaría la cookie.
export function sessionCookieName() {
  return isCookieSecure() ? `__Host-${COOKIE_BASE_NAME}` : COOKIE_BASE_NAME;
}

function positiveIntFromEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function rateLimitConfig() {
  return {
    emailShort: { limit: positiveIntFromEnv("PASSWORDLESS_EMAIL_LIMIT_15MIN", 3), windowMs: 15 * 60 * 1000 },
    emailDaily: { limit: positiveIntFromEnv("PASSWORDLESS_EMAIL_LIMIT_DAY", 10), windowMs: 24 * 60 * 60 * 1000 },
    ipShort: { limit: positiveIntFromEnv("PASSWORDLESS_IP_LIMIT_15MIN", 20), windowMs: 15 * 60 * 1000 },
    consumeIp: { limit: positiveIntFromEnv("PASSWORDLESS_CONSUME_IP_LIMIT_15MIN", 30), windowMs: 15 * 60 * 1000 },
  };
}

export function resolveFrontendUrl() {
  const raw = process.env.FRONTEND_URL;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") return null;
  return "http://localhost:5179";
}

// ---------------------------------------------------------------------------
// Primitivas criptográficas
// ---------------------------------------------------------------------------

export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isWellFormedToken(token) {
  return typeof token === "string" && TOKEN_REGEX.test(token);
}

function serverKey(purpose) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET no está definido");
  return crypto.createHmac("sha256", secret).update(`menteactiva:${purpose}:v1`).digest();
}

function keyedHash(purpose, value) {
  return crypto.createHmac("sha256", serverKey(purpose)).update(value).digest("hex");
}

export function csrfTokenForSession(sessionId) {
  return crypto
    .createHmac("sha256", serverKey("patient-session-csrf"))
    .update(String(sessionId))
    .digest("base64url");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

// ---------------------------------------------------------------------------
// Rate limiting (ventana fija persistida en PostgreSQL)
// ---------------------------------------------------------------------------

export async function hitRateLimit(scope, rawKey, { limit, windowMs }, { now = Date.now() } = {}) {
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const keyHash = keyedHash("rate-limit", `${scope}:${rawKey}`);
  const result = await db.raw(
    `INSERT INTO auth_rate_limits (scope, key_hash, window_start, count, updated_at)
     VALUES (?, ?, ?, 1, now())
     ON CONFLICT (scope, key_hash, window_start)
     DO UPDATE SET count = auth_rate_limits.count + 1, updated_at = now()
     RETURNING count`,
    [scope, keyHash, windowStart]
  );
  const count = Number(result.rows[0].count);
  return { allowed: count <= limit, count };
}

export async function purgeOldRateLimits({ now = Date.now() } = {}) {
  await db("auth_rate_limits").where("window_start", "<", new Date(now - RATE_LIMIT_RETENTION_MS)).del();
}

// ---------------------------------------------------------------------------
// Enlaces de acceso (F2)
// ---------------------------------------------------------------------------

function isEligiblePatient(user) {
  return Boolean(user && user.role === "patient" && user.is_active === true && user.allow_passwordless === true);
}

// Crea un enlace para el paciente con ese email si (y sólo si) es elegible.
// Devuelve { user, token, expiresAt } o null. Invalida los enlaces pendientes
// anteriores del mismo paciente: sólo el último correo sirve.
export async function issueLoginLink(normalizedEmail, { now = Date.now() } = {}) {
  return db.transaction(async (trx) => {
    const user = await trx("users").where({ email: normalizedEmail }).forUpdate().first();
    if (!isEligiblePatient(user)) return null;

    await trx("patient_login_links")
      .where({ user_id: user.id })
      .whereNull("consumed_at")
      .whereNull("invalidated_at")
      .update({ invalidated_at: new Date(now) });

    const token = generateToken();
    const createdAt = new Date(now);
    const expiresAt = new Date(now + LOGIN_LINK_TTL_MS);
    const [link] = await trx("patient_login_links")
      .insert({ user_id: user.id, token_hash: hashToken(token), created_at: createdAt, expires_at: expiresAt })
      .returning(["id"]);
    return { user, token, linkId: link.id, expiresAt };
  });
}

export async function invalidateLoginLink(linkId) {
  await db("patient_login_links")
    .where({ id: linkId })
    .whereNull("consumed_at")
    .update({ invalidated_at: db.fn.now() });
}

export function buildLoginLinkUrl(token, base) {
  return `${base}/#/enlace/${token}`;
}

// Consume el enlace y crea la sesión persistente en una única transacción.
// El UPDATE ... WHERE consumed_at IS NULL ... RETURNING es atómico: si dos
// requests llegan a la vez con el mismo token, PostgreSQL serializa el
// acceso a la fila y sólo una ve consumed_at NULL; la otra obtiene 0 filas.
// Devuelve { user, session, sessionToken } o null (enlace inválido, vencido,
// usado, invalidado, o paciente ya no habilitado: todos indistinguibles).
export async function consumeLoginLink(token, { now = Date.now() } = {}) {
  if (!isWellFormedToken(token)) return null;
  const tokenHash = hashToken(token);
  const nowDate = new Date(now);

  return db.transaction(async (trx) => {
    const [link] = await trx("patient_login_links")
      .where({ token_hash: tokenHash })
      .whereNull("consumed_at")
      .whereNull("invalidated_at")
      .where("expires_at", ">", nowDate)
      .update({ consumed_at: nowDate })
      .returning(["id", "user_id"]);
    if (!link) return null;

    const user = await trx("users").where({ id: link.user_id }).first();
    // El enlace queda consumido aunque el paciente ya no sea elegible: no se
    // puede reintentar con el mismo token.
    if (!isEligiblePatient(user)) return { rejected: true };

    await trx("patient_login_links")
      .where({ user_id: user.id })
      .whereNull("consumed_at")
      .whereNull("invalidated_at")
      .update({ invalidated_at: nowDate });

    const { session, sessionToken } = await createSession(trx, user.id, now);
    return { user, session, sessionToken };
  }).then((outcome) => (outcome && !outcome.rejected ? outcome : null));
}

// ---------------------------------------------------------------------------
// Sesiones persistentes (F3)
// ---------------------------------------------------------------------------

async function createSession(trx, userId, now) {
  const sessionToken = generateToken();
  const [session] = await trx("patient_auth_sessions")
    .insert({
      user_id: userId,
      token_hash: hashToken(sessionToken),
      created_at: new Date(now),
      expires_at: new Date(now + SESSION_TTL_MS),
      last_used_at: new Date(now),
    })
    .returning(["id", "user_id", "created_at", "expires_at", "rotated_at"]);
  return { session, sessionToken };
}

export function serializeCookie(name, value, { maxAgeSeconds, secure }) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookie(res, sessionToken, expiresAt, { now = Date.now() } = {}) {
  const maxAgeSeconds = (new Date(expiresAt).getTime() - now) / 1000;
  res.append("Set-Cookie", serializeCookie(sessionCookieName(), sessionToken, { maxAgeSeconds, secure: isCookieSecure() }));
}

export function clearSessionCookie(res) {
  res.append("Set-Cookie", serializeCookie(sessionCookieName(), "", { maxAgeSeconds: 0, secure: isCookieSecure() }));
}

export function readSessionCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const name = sessionCookieName();
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      return isWellFormedToken(value) ? value : null;
    }
  }
  return null;
}

export function hasSessionCookie(req) {
  const header = req.headers.cookie;
  return typeof header === "string" && header.includes(`${sessionCookieName()}=`);
}

// Busca la sesión vigente para el token presentado. Acepta el hash anterior
// sólo dentro de la ventana de gracia posterior a una rotación.
export async function findActiveSession(sessionToken, { now = Date.now() } = {}) {
  if (!isWellFormedToken(sessionToken)) return null;
  const tokenHash = hashToken(sessionToken);
  const nowDate = new Date(now);
  const graceStart = new Date(now - PREVIOUS_TOKEN_GRACE_MS);

  const row = await db("patient_auth_sessions as s")
    .join("users as u", "u.id", "s.user_id")
    .whereNull("s.revoked_at")
    .where("s.expires_at", ">", nowDate)
    .where((q) => {
      q.where("s.token_hash", tokenHash).orWhere((q2) => {
        q2.where("s.previous_token_hash", tokenHash).where("s.rotated_at", ">", graceStart);
      });
    })
    .where({ "u.role": "patient", "u.is_active": true, "u.allow_passwordless": true })
    .select(
      "s.id",
      "s.user_id",
      "s.token_hash",
      "s.created_at",
      "s.expires_at",
      "s.rotated_at",
      "s.last_used_at",
      "u.name",
      "u.email",
      "u.role"
    )
    .first();
  if (!row) return null;
  return { ...row, presentedCurrentToken: row.token_hash === tokenHash };
}

export async function touchSession(session, { now = Date.now() } = {}) {
  if (now - new Date(session.last_used_at).getTime() < LAST_USED_UPDATE_INTERVAL_MS) return;
  await db("patient_auth_sessions").where({ id: session.id }).update({ last_used_at: new Date(now) });
}

// Rota el token si pasó el intervalo. UPDATE condicional sobre el hash actual:
// si otra pestaña ya rotó, no se emite un segundo token (0 filas).
export async function maybeRotateSession(session, { now = Date.now() } = {}) {
  if (!session.presentedCurrentToken) return null;
  const lastRotation = new Date(session.rotated_at || session.created_at).getTime();
  if (now - lastRotation < SESSION_ROTATION_INTERVAL_MS) return null;
  const newToken = generateToken();
  const updated = await db("patient_auth_sessions")
    .where({ id: session.id, token_hash: session.token_hash })
    .whereNull("revoked_at")
    .update({
      previous_token_hash: session.token_hash,
      token_hash: hashToken(newToken),
      rotated_at: new Date(now),
      last_used_at: new Date(now),
    });
  return updated === 1 ? newToken : null;
}

export async function revokeSession(sessionId, reason) {
  return db("patient_auth_sessions")
    .where({ id: sessionId })
    .whereNull("revoked_at")
    .update({ revoked_at: db.fn.now(), revoked_reason: reason });
}

export async function revokeAllSessionsForUser(userId, reason, trx = db) {
  return trx("patient_auth_sessions")
    .where({ user_id: userId })
    .whereNull("revoked_at")
    .update({ revoked_at: trx.fn.now(), revoked_reason: reason });
}

export async function invalidatePendingLinksForUser(userId, trx = db) {
  return trx("patient_login_links")
    .where({ user_id: userId })
    .whereNull("consumed_at")
    .whereNull("invalidated_at")
    .update({ invalidated_at: trx.fn.now() });
}

export async function countActiveSessions(userId, { now = Date.now() } = {}, trx = db) {
  const row = await trx("patient_auth_sessions")
    .where({ user_id: userId })
    .whereNull("revoked_at")
    .where("expires_at", ">", new Date(now))
    .count({ n: "*" })
    .first();
  return Number(row?.n || 0);
}

// Autenticación por cookie para requireAuth. Devuelve:
//   { ok: true, user, session }  |  { ok: false, status, body, clearCookie }
export async function authenticateSessionCookie(req) {
  if (!isPasswordlessEnabled()) {
    return { ok: false, status: 401, body: { error: "Sesión no válida", status: "session_invalid" }, clearCookie: false };
  }
  const token = readSessionCookie(req);
  const session = token ? await findActiveSession(token) : null;
  if (!session) {
    return { ok: false, status: 401, body: { error: "Tu sesión terminó. Volvé a ingresar.", status: "session_invalid" }, clearCookie: true };
  }
  if (!SAFE_METHODS.has(req.method)) {
    const provided = req.headers[CSRF_HEADER];
    if (!safeEqual(provided, csrfTokenForSession(session.id))) {
      return { ok: false, status: 403, body: { error: "Solicitud no autorizada", status: "csrf_failed" }, clearCookie: false };
    }
  }
  await touchSession(session);
  return {
    ok: true,
    session,
    user: { id: session.user_id, role: session.role, name: session.name, email: session.email },
  };
}

export function publicSessionPayload(user, session) {
  return {
    user: { id: user.id, role: user.role, name: user.name, email: user.email },
    csrf_token: csrfTokenForSession(session.id),
    expires_at: session.expires_at,
    auth_method: "patient_session",
  };
}
