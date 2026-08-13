import { DEFAULT_PROFESSIONAL_ID, LOGIN_CREDENTIALS } from "../constants/appConfig.js";
import { PATIENT_DEFAULTS, PROFESSIONAL_DEFAULT_INSTRUCTIONS } from "../constants/content.js";

export function createWeeklyProgress() {
  return [0, 0, 0, 0, 0, 0, 0];
}

export function createPatient({
  id,
  name,
  age,
  email,
  aiInstructions,
  link,
  maxQuestions = 4,
  professionalId = DEFAULT_PROFESSIONAL_ID
}) {
  return {
    id,
    name,
    age,
    email,
    professionalId,
    mood: PATIENT_DEFAULTS.mood,
    status: PATIENT_DEFAULTS.status,
    note: PATIENT_DEFAULTS.note,
    score: PATIENT_DEFAULTS.score,
    trend: PATIENT_DEFAULTS.trend,
    responseTime: PATIENT_DEFAULTS.responseTime,
    risk: PATIENT_DEFAULTS.risk,
    aiInstructions,
    link,
    completed: [],
    answers: 0,
    maxQuestions,
    weeklyProgress: createWeeklyProgress(),
    lastSessionAt: null
  };
}

export function normalizePatient(stored) {
  const base = createPatient({
    id: stored.id,
    name: stored.name,
    age: stored.age,
    email: stored.email,
    aiInstructions: stored.aiInstructions,
    link: stored.link,
    maxQuestions: stored.maxQuestions,
    professionalId: stored.professionalId
  });
  return {
    ...base,
    ...stored,
    professionalId: stored.professionalId || DEFAULT_PROFESSIONAL_ID,
    weeklyProgress:
      Array.isArray(stored.weeklyProgress) && stored.weeklyProgress.length === 7
        ? stored.weeklyProgress
        : base.weeklyProgress,
    completed: Array.isArray(stored.completed) ? stored.completed : []
  };
}

export function isSameCalendarWeek(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const weekStart = (d) => {
    const copy = new Date(d);
    copy.setDate(d.getDate() - d.getDay());
    copy.setHours(0, 0, 0, 0);
    return copy.getTime();
  };
  return weekStart(date) === weekStart(now);
}

export function isSameCalendarDay(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function refreshDailyPatientState(patient, now = new Date()) {
  if (isSameCalendarDay(patient.lastSessionAt, now) || patient.completed.length === 0) return patient;
  const sameWeek = isSameCalendarWeek(patient.lastSessionAt, now);
  return {
    ...patient,
    completed: [],
    ...(!sameWeek ? { weeklyProgress: createWeeklyProgress() } : {})
  };
}

export function slugifyPatientName(value) {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || ""
  );
}

export function generatePatientId(name, fallbackIndex) {
  return slugifyPatientName(name) || `paciente-${fallbackIndex}`;
}

export const DEMO_PROFILES = {
  elena: {
    mood: "bien",
    status: "Rendimiento óptimo",
    note: "Última sesión completada con buen ritmo y sin errores en la primera vuelta.",
    score: 82,
    trend: "+4%",
    responseTime: "3.4 s",
    risk: "Bajo",
    weeklyProgress: [0, 30, 60, 40, 80, 50, 0],
    answers: 42
  },
  carlos: {
    mood: "cansancio",
    status: "En seguimiento",
    note: "Se cansa hacia el final de la sesión. Conviene sesiones más cortas.",
    score: 58,
    trend: "-3%",
    responseTime: "6.8 s",
    risk: "Medio",
    weeklyProgress: [20, 40, 0, 30, 0, 20, 0],
    answers: 28
  },
  marta: {
    mood: "calma",
    status: "Rendimiento estable",
    note: "Trabaja con precisión pero necesita más tiempo para responder.",
    score: 74,
    trend: "+1%",
    responseTime: "5.1 s",
    risk: "Bajo",
    weeklyProgress: [0, 20, 40, 40, 60, 30, 0],
    answers: 35
  },
  jorge: {
    mood: "tristeza",
    status: "Requiere apoyo",
    note: "Baja en las últimas dos sesiones. Sugerido revisar ánimo antes de comenzar.",
    score: 46,
    trend: "-8%",
    responseTime: "7.2 s",
    risk: "Medio",
    weeklyProgress: [10, 0, 20, 0, 10, 0, 0],
    answers: 18
  },
  rosa: {
    mood: "alegria",
    status: "Rendimiento óptimo",
    note: "Muy participativa. Nombró correctamente 9 de 10 objetos en la última sesión.",
    score: 89,
    trend: "+6%",
    responseTime: "2.9 s",
    risk: "Bajo",
    weeklyProgress: [40, 60, 60, 80, 100, 70, 30],
    answers: 51
  },
  alberto: {
    mood: "calma",
    status: "En seguimiento",
    note: "Cálculo simple estable; orientación temporal con dificultad para fechas exactas.",
    score: 65,
    trend: "+2%",
    responseTime: "4.6 s",
    risk: "Bajo",
    weeklyProgress: [0, 30, 40, 20, 50, 40, 0],
    answers: 31
  },
  lucia: {
    mood: "bien",
    status: "Rendimiento estable",
    note: "Recién comienza; muestra buena disposición y sostiene la atención sin problema.",
    score: 71,
    trend: "+3%",
    responseTime: "4.1 s",
    risk: "Bajo",
    weeklyProgress: [20, 30, 40, 30, 40, 20, 0],
    answers: 22
  },
  hector: {
    mood: "cansancio",
    status: "Requiere apoyo",
    note: "Sesiones cortas por ahora; se distrae después de la tercera pregunta.",
    score: 52,
    trend: "-2%",
    responseTime: "6.2 s",
    risk: "Medio",
    weeklyProgress: [10, 20, 10, 20, 0, 20, 0],
    answers: 24
  }
};

function withProfile(base, profile) {
  return profile ? { ...base, ...profile } : base;
}

export function buildInitialPatients() {
  return [
    withProfile(createPatient({
      id: "elena",
      name: "Elena Ríos",
      age: 72,
      email: LOGIN_CREDENTIALS.patient.email,
      aiInstructions: "Usar preguntas breves, ejemplos cotidianos y refuerzo amable. Evitar consignas con más de dos datos juntos.",
      link: "https://menteactiva.demo/p/elena",
      maxQuestions: 5
    }), DEMO_PROFILES.elena),
    withProfile(createPatient({
      id: "carlos",
      name: "Carlos Molina",
      age: 78,
      email: "carlos.molina@demo.com",
      aiInstructions: "Priorizar sesiones cortas, pausas y preguntas con orientación temporal.",
      link: "https://menteactiva.demo/p/carlos"
    }), DEMO_PROFILES.carlos),
    withProfile(createPatient({
      id: "marta",
      name: "Marta Fernández",
      age: 68,
      email: "marta.fernandez@demo.com",
      aiInstructions: "Enfocarse en memoria episódica reciente. Usar lenguaje simple y evitar términos médicos. Reforzar positivamente cada respuesta.",
      link: "https://menteactiva.demo/p/marta",
      maxQuestions: 4
    }), DEMO_PROFILES.marta),
    withProfile(createPatient({
      id: "jorge",
      name: "Jorge Benítez",
      age: 81,
      email: "jorge.benitez@demo.com",
      aiInstructions: "Sesiones muy breves (máximo 3 preguntas). Orientación espacial y temporal prioritaria. Tono cálido y paciente.",
      link: "https://menteactiva.demo/p/jorge",
      maxQuestions: 3
    }), DEMO_PROFILES.jorge),
    withProfile(createPatient({
      id: "rosa",
      name: "Rosa Gutiérrez",
      age: 74,
      email: "rosa.gutierrez@demo.com",
      aiInstructions: "Trabajar fluidez verbal y atención sostenida. Incluir actividades de nombrar objetos y secuencias simples.",
      link: "https://menteactiva.demo/p/rosa",
      maxQuestions: 5
    }), DEMO_PROFILES.rosa),
    withProfile(createPatient({
      id: "alberto",
      name: "Alberto Suárez",
      age: 76,
      email: "alberto.suarez@demo.com",
      aiInstructions: "Priorizar ejercicios de cálculo simple y orientación en el tiempo. Evitar preguntas con múltiples partes.",
      link: "https://menteactiva.demo/p/alberto",
      maxQuestions: 4
    }), DEMO_PROFILES.alberto),
    withProfile(createPatient({
      id: "lucia",
      name: "Lucía Herrera",
      age: 69,
      email: "lucia.herrera@demo.com",
      aiInstructions: "Introducción progresiva. Empezar con preguntas breves de memoria episódica y sumar dificultad según respuesta.",
      link: "https://menteactiva.demo/p/lucia",
      maxQuestions: 5
    }), DEMO_PROFILES.lucia),
    withProfile(createPatient({
      id: "hector",
      name: "Héctor Ramos",
      age: 83,
      email: "hector.ramos@demo.com",
      aiInstructions: "Sesiones muy cortas (máximo 3 preguntas). Tono muy calmo y refuerzo positivo constante.",
      link: "https://menteactiva.demo/p/hector",
      maxQuestions: 3
    }), DEMO_PROFILES.hector)
  ];
}

export function createNewProfessionalPatient({ patientId, name, age, professionalId }) {
  return createPatient({
    id: patientId,
    name,
    age,
    email: `${patientId}@demo.com`,
    aiInstructions: PROFESSIONAL_DEFAULT_INSTRUCTIONS,
    link: `https://menteactiva.demo/p/${patientId}`,
    professionalId
  });
}
