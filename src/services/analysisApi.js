import { authRequest } from "./authRequest.js";

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
