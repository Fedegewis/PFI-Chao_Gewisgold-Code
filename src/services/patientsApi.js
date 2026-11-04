import { authHeaders } from "./authService.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function apiRequest(path, options = {}) {
  // JWT (Authorization) o, para pacientes con sesión por enlace, sólo el
  // header anti-CSRF: la cookie HttpOnly la adjunta el navegador (same-origin).
  const auth = authHeaders();
  if (!auth) {
    const err = new Error("No hay sesión activa");
    err.status = 401;
    throw err;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...auth,
      ...options.headers,
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error) || "Error del servidor");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function fetchPatients() {
  return apiRequest("/patients", { method: "GET" });
}

export async function deletePatientApi(patientId) {
  return apiRequest(`/patients/${patientId}`, { method: "DELETE" });
}

// F1: permiso individual de acceso sin contraseña (sólo el profesional dueño).
export async function fetchPatientAccess(patientId) {
  return apiRequest(`/patients/${patientId}/access`, { method: "GET" });
}

// E2: al desactivar con sesiones abiertas el backend exige confirmación
// explícita (409 confirmation_required) antes de revocarlas.
export async function savePatientAccess(patientId, allowPasswordless, { confirmRevokeSessions } = {}) {
  const body = { allow_passwordless: allowPasswordless };
  if (confirmRevokeSessions) body.confirm_revoke_sessions = true;
  return apiRequest(`/patients/${patientId}/access`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function revokePatientSessions(patientId) {
  return apiRequest(`/patients/${patientId}/access/revoke-sessions`, { method: "POST" });
}

// Eliminación física de una sesión no completada (sólo el profesional dueño).
export async function deleteSessionApi(sessionId) {
  return apiRequest(`/sessions/${sessionId}`, { method: "DELETE" });
}

export async function fetchPatientSessionsApi(patientId, { signal } = {}) {
  return apiRequest(`/patients/${patientId}/sessions`, { method: "GET", signal });
}
