import { authRequest } from "./authRequest.js";

// La cantidad y los dominios se resuelven server-side desde la configuración
// persistida del paciente (users.max_questions / users.active_domain_slugs).
// El cliente sólo indica qué sección iniciar y, opcionalmente, el mood
// autorreportado al momento de iniciar la sesión (snapshot inmutable en DB).
export async function createPatientSession({ sectionSlug, patientReportedMood } = {}) {
  const body = { sections: [{ section_slug: sectionSlug }] };
  if (patientReportedMood) {
    body.patient_reported_mood = patientReportedMood;
  }
  return authRequest("/patient/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function startSessionApi(sessionId) {
  return authRequest(`/sessions/${sessionId}/start`, { method: "POST" });
}

export async function submitAnswerApi({ sessionId, sessionQuestionId, selectedAnswer, responseTimeMs }) {
  return authRequest(`/sessions/${sessionId}/answers`, {
    method: "POST",
    body: JSON.stringify({
      session_question_id: sessionQuestionId,
      selected_answer: selectedAnswer,
      response_time_ms: responseTimeMs,
    }),
  });
}

export async function completeSessionApi(sessionId) {
  return authRequest(`/sessions/${sessionId}/complete`, { method: "POST" });
}

export async function abandonSessionApi(sessionId) {
  return authRequest(`/sessions/${sessionId}/abandon`, { method: "POST" });
}

// 7H.2: historial propio del paciente autenticado. patient_id se deriva
// server-side desde el JWT; no se envía nada desde el cliente.
export async function fetchMySessionsApi({ signal } = {}) {
  return authRequest("/patient/sessions", { method: "GET", signal });
}
