const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

function readStoredToken() {
  try {
    return localStorage.getItem("ma_auth_token");
  } catch {
    return null;
  }
}

export function getToken() {
  return readStoredToken();
}

// El JWT dura 24 h. Al abrir la app, un token vencido no debe mostrar la
// pantalla autenticada (todas las llamadas fallarían con 401). Sólo se lee
// `exp` para decidir la pantalla inicial; la validación real es del backend.
// Un token ilegible no se descarta acá: si no sirve, el primer 401 de la API
// cierra la sesión igual (ver authRequest.js).
export function isStoredTokenExpired(now = Date.now()) {
  const token = readStoredToken();
  if (!token) return false;
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json?.exp !== "number") return false;
    return json.exp * 1000 <= now;
  } catch {
    return false;
  }
}

export function setToken(token) {
  if (token) {
    localStorage.setItem("ma_auth_token", token);
  } else {
    localStorage.removeItem("ma_auth_token");
  }
}

export function clearAuth() {
  localStorage.removeItem("ma_auth_token");
  localStorage.removeItem("ma_auth_user");
  clearPatientCookieSession();
}

// ---------------------------------------------------------------------------
// F2/F3 — sesión de paciente por enlace (cookie HttpOnly).
//
// El token de sesión vive SOLO en la cookie HttpOnly: JavaScript no puede
// leerlo. Lo único que el frontend conserva es, en memoria:
//   - el usuario (para pintar la pantalla), y
//   - el token anti-CSRF (se manda en X-CSRF-Token en POST/PATCH/DELETE).
// En localStorage sólo queda una marca booleana sin valor de credencial
// ("hay que intentar restaurar la sesión al recargar"). No se guardan
// tokens, enlaces ni datos del usuario.
// ---------------------------------------------------------------------------

const PATIENT_SESSION_HINT_KEY = "ma_patient_session_hint";
let patientCookieSession = null; // { user, csrfToken }

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage bloqueado: la sesión sigue válida en memoria */
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export function hasPatientSessionHint() {
  try {
    return localStorage.getItem(PATIENT_SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function getPatientCookieSession() {
  return patientCookieSession;
}

function setPatientCookieSession(data) {
  patientCookieSession = { user: data.user, csrfToken: data.csrf_token };
  safeStorageSet(PATIENT_SESSION_HINT_KEY, "1");
}

export function clearPatientCookieSession() {
  patientCookieSession = null;
  safeStorageRemove(PATIENT_SESSION_HINT_KEY);
}

// Headers de autenticación para los clientes de API. JWT si existe (login
// con contraseña, profesionales, Google); si no, la sesión por cookie sólo
// necesita el header anti-CSRF. null = no hay sesión.
export function authHeaders() {
  const token = readStoredToken();
  if (token) return { Authorization: `Bearer ${token}` };
  if (patientCookieSession) return { "X-CSRF-Token": patientCookieSession.csrfToken };
  return null;
}

// Las cookies de sesión sólo viajan si la API está en el mismo origen que la
// app (proxy /api de F0: vercel.json en producción, proxy de Vite en local).
export function isSameOriginApi() {
  if (typeof window === "undefined") return false;
  try {
    return new URL(API_URL, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function getSavedUser() {
  try {
    const raw = localStorage.getItem("ma_auth_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUser(user) {
  localStorage.setItem("ma_auth_user", JSON.stringify(user));
}

export function persistAuthSession({ user, token }) {
  setToken(token);
  saveUser(user);
}

export const SERVER_UNAVAILABLE_MESSAGE =
  "No se pudo conectar con el servidor. Intentá nuevamente en unos minutos.";

// La respuesta puede no ser JSON (p. ej. página de error 502/504 del proxy de
// Vercel o de Render). Devuelve null en lugar de propagar un SyntaxError.
async function readJsonSafely(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function buildResponseError(res, data) {
  const fallback = data ? "Error del servidor" : SERVER_UNAVAILABLE_MESSAGE;
  const err = new Error((data && data.error) || fallback);
  err.status = res.status;
  return err;
}

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await readJsonSafely(res);
  // Un 2xx sin JSON tampoco es una respuesta válida: evita persistir token/user indefinidos.
  if (!res.ok || !data) {
    throw buildResponseError(res, data);
  }
  return data;
}

export async function registerProfessional({ name, email, password }) {
  const data = await apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  setToken(data.token);
  saveUser(data.user);
  return data;
}

export async function loginWithPassword({ email, password }) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  saveUser(data.user);
  return data;
}

export const loginProfessional = loginWithPassword;

export async function loginWithGoogle(credential) {
  // [DEBUG-TEMP google-auth] instrumentación para diagnosticar "Failed to fetch" en primer intento.
  // Retirar cuando se cierre el bug.
  const attempt = typeof window !== "undefined" ? (window.__gAuthAttempt ?? "?") : "?";
  const tag = `[google-auth][attempt-${attempt}]`;
  const t0 = Date.now();
  console.debug(`${tag} loginWithGoogle START url=${API_URL}/auth/google origin=${typeof window !== "undefined" ? window.location.origin : "(no-window)"}`);
  let res;
  try {
    res = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
  } catch (err) {
    console.debug(`${tag} FETCH THREW (network/CORS/aborted) after ${Date.now() - t0}ms name=${err?.name} message=${err?.message}`);
    throw err;
  }
  console.debug(`${tag} fetch RESPONSE received status=${res.status} ok=${res.ok} after ${Date.now() - t0}ms`);
  const data = await readJsonSafely(res);
  if (!data) {
    console.debug(`${tag} JSON PARSE FAILED after ${Date.now() - t0}ms status=${res.status}`);
  }
  if (!res.ok || !data) {
    console.debug(`${tag} response NOT OK status=${res.status} error=${data?.error}`);
    throw buildResponseError(res, data);
  }
  setToken(data.token);
  saveUser(data.user);
  console.debug(`${tag} loginWithGoogle OK total=${Date.now() - t0}ms userId=${data?.user?.id}`);
  return data;
}

export async function fetchCurrentUser() {
  const token = readStoredToken();
  if (!token) return null;
  try {
    const data = await apiRequest("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    saveUser(data.user);
    return data.user;
  } catch {
    clearAuth();
    return null;
  }
}

export async function fetchPasswordlessConfig() {
  if (!isSameOriginApi()) return { enabled: false };
  try {
    const data = await apiRequest("/auth/passwordless/config", { method: "GET" });
    return { enabled: data.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export async function requestPatientLoginLink(email) {
  return apiRequest("/auth/patient-link/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// El token del enlace viaja en el BODY de un POST (nunca en la URL del
// request): no queda en logs de proxies ni del servidor.
export async function consumePatientLoginLink(token) {
  const res = await fetch(`${API_URL}/auth/patient-link/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await readJsonSafely(res);
  if (!res.ok || !data) {
    const err = buildResponseError(res, data);
    err.code = data?.status || null;
    throw err;
  }
  if (!data.user || data.user.role !== "patient" || !data.csrf_token) {
    throw new Error("Respuesta inesperada del servidor");
  }
  // Nunca se mezclan los dos mecanismos: una sesión por enlace reemplaza
  // cualquier JWT viejo guardado en este navegador.
  localStorage.removeItem("ma_auth_token");
  localStorage.removeItem("ma_auth_user");
  setPatientCookieSession(data);
  return data;
}

// Acepta una invitación SIN contraseña: el backend crea al paciente y abre
// una sesión por cookie (igual que el canje de un enlace). El token de la
// invitación viaja en la URL del POST, como en la aceptación con contraseña.
export async function acceptInvitationWithoutPassword(token) {
  const res = await fetch(`${API_URL}/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passwordless: true }),
  });
  const data = await readJsonSafely(res);
  if (!res.ok || !data) {
    const err = buildResponseError(res, data);
    err.data = data;
    err.code = data?.status || null;
    throw err;
  }
  if (!data.user || data.user.role !== "patient" || !data.csrf_token) {
    throw new Error("Respuesta inesperada del servidor");
  }
  localStorage.removeItem("ma_auth_token");
  localStorage.removeItem("ma_auth_user");
  setPatientCookieSession(data);
  return data;
}

// Restaura la sesión por cookie al recargar. Devuelve el usuario o null.
// Un error de red NO borra la marca (se puede reintentar); un 401 sí.
export async function restorePatientSession() {
  const res = await fetch(`${API_URL}/auth/patient-session`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await readJsonSafely(res);
  if (res.status === 401) {
    clearPatientCookieSession();
    return null;
  }
  if (!res.ok || !data?.user || data.user.role !== "patient" || !data.csrf_token) {
    throw buildResponseError(res, data);
  }
  setPatientCookieSession(data);
  return data.user;
}

export async function logoutPatientSession() {
  const session = patientCookieSession;
  clearPatientCookieSession();
  try {
    await fetch(`${API_URL}/auth/patient-session/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { "X-CSRF-Token": session.csrfToken } : {}),
      },
    });
  } catch {
    /* sin red: la cookie se revoca igual al vencer; el estado local ya se limpió */
  }
}
