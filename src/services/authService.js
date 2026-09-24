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

export async function loginProfessional({ email, password }) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  saveUser(data.user);
  return data;
}

export async function loginWithGoogle(credential) {
  const data = await apiRequest("/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  setToken(data.token);
  saveUser(data.user);
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
