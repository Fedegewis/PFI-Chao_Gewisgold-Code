import { authRequest } from "./authRequest.js";

export function fetchCognitiveDomains() {
  return authRequest("/cognitive-domains", { method: "GET" });
}

export function fetchTrainingConfig(patientId) {
  return authRequest(`/patients/${patientId}/training-config`, { method: "GET" });
}

// F2: active_section_slugs es opcional. Si no se pasa, el PUT no toca esa
// columna (el service de backend sólo aplica keys presentes en el body).
export function saveTrainingConfig(patientId, { max_questions, active_domain_slugs, active_section_slugs }) {
  const body = { max_questions, active_domain_slugs };
  if (active_section_slugs !== undefined) {
    body.active_section_slugs = active_section_slugs;
  }
  return authRequest(`/patients/${patientId}/training-config`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function fetchTrainingAvailability(patientId) {
  return authRequest(`/patients/${patientId}/training-availability`, { method: "GET" });
}

// F3: endpoint para la pantalla del paciente. Devuelve qué secciones son
// iniciables (startable=true) con la configuración vigente.
export function fetchPatientAvailableSections() {
  return authRequest("/patient/available-sections", { method: "GET" });
}
