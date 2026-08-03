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
    rt: PATIENT_DEFAULTS.responseTime,
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
  return {
    ...patient,
    completed: []
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
