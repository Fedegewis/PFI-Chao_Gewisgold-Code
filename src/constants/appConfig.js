// Solo se conserva metadata del profesional demo usada por los pacientes hardcodeados
// del PatientScreen legacy (buildInitialPatients). NO se usa para autenticación real.
// TODO(6C.5+): eliminar cuando se migre el PatientScreen a datos reales del backend.
export const DEMO_PROFESSIONAL_ID = import.meta.env.VITE_PROFESSIONAL_ID ?? "psico-01";
export const DEFAULT_PROFESSIONAL_ID = DEMO_PROFESSIONAL_ID;

export const SCREEN_NAMES = {
  login: "login",
  patient: "patient",
  activity: "activity",
  professional: "professional",
  invite: "invite"
};

export const MOTIVATION_MESSAGES = [
  "Hoy también cuenta: una pregunta hecha con calma ya es parte del entrenamiento.",
  "Tu ritmo es parte del entrenamiento, no un obstáculo.",
  "Cada actividad que hacés fortalece tu mente, aunque no lo notes enseguida.",
  "No importa cuánto tardes, lo que importa es que estás acá.",
  "Tu esfuerzo de hoy es una inversión en tu bienestar de mañana.",
  "Practicar un poco cada día hace más que mucho de vez en cuando.",
  "La constancia es tu mejor herramienta. Ya estás usándola.",
  "Equivocarse también entrena. Cada intento cuenta.",
  "Tu mente se mantiene activa porque vos decidís ejercitarla.",
  "Lo importante no es la velocidad, es la decisión de seguir.",
  "Cada sesión es un paso más en tu camino.",
  "Hoy es un buen día para ejercitar la mente.",
  "Volviste, y eso ya es un logro. Tu compromiso se nota.",
  "Tomátelo con calma: no hay apuro, hay progreso."
];

export const COMPLETION_MESSAGES = [
  "Completaste la actividad. Tu mente agradeció el ejercicio.",
  "Sesión terminada. Cada práctica refuerza lo que ya sabés.",
  "Muy bien. Descansar después de practicar también es parte del proceso.",
  "Actividad finalizada. Tu constancia es lo que marca la diferencia.",
  "Listo. Recordá que cada sesión suma, aunque parezca simple.",
  "Terminaste. Mañana tu mente va a estar un poquito más preparada.",
  "Sesión completa. El esfuerzo que hiciste hoy tiene valor."
];

export const MOOD_OPTIONS = [
  { id: "alegria", label: "Alegría", note: "Estás con mucha energía hoy.", risk: "Bajo" },
  { id: "bien", label: "Bien", note: "Te sentís con energía para seguir.", risk: "Bajo" },
  { id: "calma", label: "Calma", note: "Preferís avanzar con pausas y sin apuro.", risk: "Bajo" },
  { id: "cansancio", label: "Cansancio", note: "Conviene una sesión breve o más guiada.", risk: "Medio" },
  { id: "tristeza", label: "Tristeza", note: "Podemos empezar con algo suave, sin exigencia.", risk: "Medio" }
];

export const COGNITIVE_DOMAINS = [
  "Memoria",
  "Atención",
  "Funciones ejecutivas",
  "Orientación",
  "Comprensión y lenguaje"
];

export const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

export const MAX_PATIENT_AGE = 120;
export const MAX_AI_QUESTIONS = 10;
export const MIN_AI_QUESTIONS = 1;

// Umbral de latencia (ms) por encima del cual una respuesta se considera lenta.
export const SLOW_MS = 6000;

// Mapa actividad frontend → slug de sección backend. Necesario para 6D.1 hasta que
// las actividades pasen a construirse desde el banco real.
export const ACTIVITY_TO_SECTION_SLUG = {
  market: "memoria_de_trabajo",
  bus: "atencion_y_calculo",
  recipe: "funciones_ejecutivas",
  calendar: "orientacion_temporal",
  names: "memoria_asociativa",
  wellbeing: "metacognicion",
  medication: "memoria_prospectiva",
  home: "atencion_visual",
  phone: "comprension_funcional",
  orientation: "orientacion_espacial",
};
