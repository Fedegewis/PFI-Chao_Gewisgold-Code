export const PATIENT_DEFAULTS = {
  // null = ausencia de autorreporte. NO es un mood válido ni un sentinel de UI:
  // los textos visibles como "Sin registrar" los resuelve cada vista en su capa de
  // presentación. El whitelist real de moods vive en MOOD_OPTIONS (appConfig.js)
  // y debe mantenerse sincronizado con el CHECK de sessions.patient_reported_mood.
  mood: null,
  status: "Sin actividades completadas",
  note: "Todavía no realizó actividades en esta sesión.",
  score: 0,
  trend: "0%",
  responseTime: "-",
  risk: "Bajo"
};

export const PROFESSIONAL_DEFAULT_INSTRUCTIONS =
  "Hacer preguntas simples, de una consigna por vez, y registrar estado emocional.";

export const LOGIN_ERROR_MESSAGE = "Credenciales incorrectas. Revisá el README o usá los datos demo.";
export const ACTIVITY_DRAFT_MESSAGE = "La sesión se registra al finalizar";
export const EMPTY_CHART_MESSAGE =
  "Todavía no hay sesiones registradas. Cuando el paciente complete actividades vas a ver acá su evolución de precisión y tiempos.";

