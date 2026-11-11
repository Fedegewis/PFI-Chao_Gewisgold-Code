import { authRequest as apiRequest } from "./authRequest.js";

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

// Opción A: el profesional dueño crea o reemplaza la contraseña del paciente.
export async function setPatientPasswordByProfessional(patientId, password) {
  return apiRequest(`/patients/${patientId}/password`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
}

// Opción B: el paciente autenticado (enlace o contraseña) gestiona la suya.
export async function fetchOwnPasswordStatus() {
  return apiRequest("/patient/password", { method: "GET" });
}

export async function saveOwnPassword(password, currentPassword) {
  const body = { password };
  if (currentPassword) body.current_password = currentPassword;
  return apiRequest("/patient/password", { method: "PUT", body: JSON.stringify(body) });
}

// Eliminación física de una sesión no completada (sólo el profesional dueño).
export async function deleteSessionApi(sessionId) {
  return apiRequest(`/sessions/${sessionId}`, { method: "DELETE" });
}

export async function fetchPatientSessionsApi(patientId, { signal } = {}) {
  return apiRequest(`/patients/${patientId}/sessions`, { method: "GET", signal });
}
