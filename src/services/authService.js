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

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || "Error del servidor");
    err.status = res.status;
    throw err;
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
  // eslint-disable-next-line no-console
  console.debug(`${tag} loginWithGoogle START url=${API_URL}/auth/google origin=${typeof window !== "undefined" ? window.location.origin : "(no-window)"}`);
  let res;
  try {
    res = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug(`${tag} FETCH THREW (network/CORS/aborted) after ${Date.now() - t0}ms name=${err?.name} message=${err?.message}`);
    throw err;
  }
  // eslint-disable-next-line no-console
  console.debug(`${tag} fetch RESPONSE received status=${res.status} ok=${res.ok} after ${Date.now() - t0}ms`);
  let data;
  try {
    data = await res.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug(`${tag} JSON PARSE FAILED after ${Date.now() - t0}ms name=${err?.name} message=${err?.message}`);
    throw err;
  }
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.debug(`${tag} response NOT OK status=${res.status} error=${data?.error}`);
    const err = new Error(data.error || "Error del servidor");
    err.status = res.status;
    throw err;
  }
  setToken(data.token);
  saveUser(data.user);
  // eslint-disable-next-line no-console
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
