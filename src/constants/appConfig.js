export const LOGIN_CREDENTIALS = {
  patient: {
    email: import.meta.env.VITE_PATIENT_EMAIL ?? "elena.rios@demo.com",
    password: import.meta.env.VITE_PATIENT_PASSWORD ?? "menteactiva"
  },
  professional: {
    email: import.meta.env.VITE_PROFESSIONAL_EMAIL ?? "psicologa@demo.com",
    password: import.meta.env.VITE_PROFESSIONAL_PASSWORD ?? "jardin2",
    id: import.meta.env.VITE_PROFESSIONAL_ID ?? "psico-01",
    name: import.meta.env.VITE_PROFESSIONAL_NAME ?? "Dra. Ana Gomez"
  }
};

// Cuentas de paciente para la demo. En produccion vendria del backend.
export const PATIENT_LOGINS = [
  { email: "elena.rios@demo.com",     password: "menteactiva", patientId: "elena" },
  { email: "lucia.herrera@demo.com",  password: "jardin",      patientId: "lucia" },
  { email: "hector.ramos@demo.com",   password: "jardin",      patientId: "hector" }
];

export const DEFAULT_PROFESSIONAL_ID = LOGIN_CREDENTIALS.professional.id;

export const SCREEN_NAMES = {
  login: "login",
  patient: "patient",
  activity: "activity",
  professional: "professional"
};

export const MOTIVATION_MESSAGES = [
  "Hoy también cuenta: una pregunta hecha con calma ya riega el jardín.",
  "Avanzar poquito sigue siendo avanzar.",
  "Tu ritmo es parte del entrenamiento, no un obstáculo."
];

export const MOOD_OPTIONS = [
  { id: "alegria", label: "Alegría", note: "Estás con muchas ganas de jugar hoy.", risk: "Bajo" },
  { id: "bien", label: "Bien", note: "Te sentís con energía para seguir.", risk: "Bajo" },
  { id: "calma", label: "Calma", note: "Preferís avanzar con pausas y sin apuro.", risk: "Bajo" },
  { id: "cansancio", label: "Cansancio", note: "Conviene una sesión breve o más guiada.", risk: "Medio" },
  { id: "tristeza", label: "Tristeza", note: "Podemos empezar con algo suave, sin exigencia.", risk: "Medio" }
];

export const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

export const MAX_PATIENT_AGE = 120;
export const MAX_AI_QUESTIONS = 10;
export const MIN_AI_QUESTIONS = 1;

// Umbral de latencia (ms) por encima del cual una respuesta se considera lenta.
export const SLOW_MS = 6000;
