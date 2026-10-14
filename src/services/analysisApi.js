import { getToken } from "./authService.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function authRequest(path, options = {}) {
  const token = getToken();
  if (!token) {
    const err = new Error("No hay sesión activa");
    err.status = 401;
    throw err;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

export async function getAnalysis(sessionId) {
  return authRequest(`/sessions/${sessionId}/analysis`, { method: "GET" });
}

export async function generateAnalysis(sessionId, { force = false } = {}) {
  const query = force ? "?force=true" : "";
  return authRequest(`/sessions/${sessionId}/analysis${query}`, { method: "POST" });
}

// v3.4 — Contexto determinístico de una sesión completada. Devuelve
// activities + evidence + comparison_metrics + observations + follow_up
// construidos por el backend sin depender de Ollama. Permite al panel
// mostrar los primeros 4 bloques del informe aun cuando no hay un
// análisis IA exitoso.
export async function getAnalysisContext(sessionId) {
  return authRequest(`/sessions/${sessionId}/analysis-context`, { method: "GET" });
}
