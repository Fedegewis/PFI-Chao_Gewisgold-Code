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
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || ""
  );
}

export function generatePatientId(name, fallbackIndex) {
  return slugifyPatientName(name) || `paciente-${fallbackIndex}`;
}

export function buildInitialPatients() {
  return [
    createPatient({
      id: "elena",
      name: "Elena Rios",
      age: 72,
      email: LOGIN_CREDENTIALS.patient.email,
      aiInstructions: "Usar preguntas breves, ejemplos cotidianos y refuerzo amable. Evitar consignas con mas de dos datos juntos.",
      link: "https://menteactiva.demo/p/elena",
      maxQuestions: 5
    }),
    createPatient({
      id: "carlos",
      name: "Carlos Molina",
      age: 78,
      email: "carlos.molina@demo.com",
      aiInstructions: "Priorizar sesiones cortas, pausas y preguntas con orientacion temporal.",
      link: "https://menteactiva.demo/p/carlos"
    }),
    createPatient({
      id: "marta",
      name: "Marta Fernandez",
      age: 68,
      email: "marta.fernandez@demo.com",
      aiInstructions: "Enfocarse en memoria episodica reciente. Usar lenguaje simple y evitar terminos medicos. Reforzar positivamente cada respuesta.",
      link: "https://menteactiva.demo/p/marta",
      maxQuestions: 4
    }),
    createPatient({
      id: "jorge",
      name: "Jorge Benitez",
      age: 81,
      email: "jorge.benitez@demo.com",
      aiInstructions: "Sesiones muy breves (maximo 3 preguntas). Orientacion espacial y temporal prioritaria. Tono calido y paciente.",
      link: "https://menteactiva.demo/p/jorge",
      maxQuestions: 3
    }),
    createPatient({
      id: "rosa",
      name: "Rosa Gutierrez",
      age: 74,
      email: "rosa.gutierrez@demo.com",
      aiInstructions: "Trabajar fluidez verbal y atencion sostenida. Incluir actividades de nombrar objetos y secuencias simples.",
      link: "https://menteactiva.demo/p/rosa",
      maxQuestions: 5
    }),
    createPatient({
      id: "alberto",
      name: "Alberto Suarez",
      age: 76,
      email: "alberto.suarez@demo.com",
      aiInstructions: "Priorizar ejercicios de calculo simple y orientacion en el tiempo. Evitar preguntas con multiples partes.",
      link: "https://menteactiva.demo/p/alberto",
      maxQuestions: 4
    })
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
