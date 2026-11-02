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
