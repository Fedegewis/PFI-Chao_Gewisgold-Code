import { SLOW_MS } from "../constants/appConfig.js";
import { formatLatency, formatShortDate } from "../lib/format.js";

export function averageField(items, key) {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + item[key], 0) / items.length;
}

export function summarizeAnswers(list) {
  const total = list.length;
  const correctCount = list.filter((answer) => answer.correct).length;
  const accuracy = total ? Math.round((correctCount / total) * 100) : 0;
  const avgLatencyMs = total ? Math.round(list.reduce((sum, answer) => sum + answer.latencyMs, 0) / total) : 0;
  return { total, correctCount, accuracy, avgLatencyMs, answers: list };
}

export function getPatientSessions(sessions, patientId) {
  return sessions.filter((session) => session.patientId === patientId);
}

export function countSessionsThisWeek(sessions) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return sessions.filter((session) => now - new Date(session.date).getTime() <= weekMs).length;
}

export function buildCompletedActivityState({ patient, sessions, activity, summary, totalActivities, now = new Date() }) {
  const session = {
    id: `${patient.id}-${activity.id}-${now.getTime()}`,
    patientId: patient.id,
    activityId: activity.id,
    activityTitle: activity.title,
    skill: activity.skill,
    date: now.toISOString(),
    correct: summary.correctCount,
    total: summary.total,
    accuracy: summary.accuracy,
    avgLatencyMs: summary.avgLatencyMs
  };
  const nextSessions = [...sessions, session];
  const patientSessions = getPatientSessions(nextSessions, patient.id);
  const todayIndex = now.getDay();
  const nextWeeklyProgress = [...patient.weeklyProgress];
  nextWeeklyProgress[todayIndex] = Math.min(100, nextWeeklyProgress[todayIndex] + Math.round(100 / totalActivities));
  const completed = Array.from(new Set([...patient.completed, activity.id]));
  const avgAccuracy = Math.round(averageField(patientSessions, "accuracy"));
  const avgLatencyMs = Math.round(averageField(patientSessions, "avgLatencyMs"));
  const previousSessions = patientSessions.slice(0, -1);
  const previousAvg = previousSessions.length
    ? Math.round(averageField(previousSessions, "accuracy"))
    : avgAccuracy;
  const delta = avgAccuracy - previousAvg;

  return {
    nextSessions,
    patientPatch: {
      completed,
      answers: patient.answers + summary.total,
      score: avgAccuracy,
      trend: `${delta >= 0 ? "+" : ""}${delta}%`,
      status: session.accuracy >= 70 ? "Rendimiento optimo" : session.accuracy >= 50 ? "En seguimiento" : "Requiere apoyo",
      note: `Ultima actividad: ${session.activityTitle} - ${session.accuracy}% de aciertos, ${formatLatency(session.avgLatencyMs)} promedio.`,
      responseTime: formatLatency(avgLatencyMs),
      risk: session.avgLatencyMs > SLOW_MS || session.accuracy < 50 ? "Medio" : "Bajo",
      weeklyProgress: nextWeeklyProgress,
      lastSessionAt: session.date
    }
  };
}

// Perfiles sinteticos por paciente (solo para demo). Se borran al Reiniciar demo.
const SYNTHETIC_PROFILES = {
  elena:   { count: 12, base: 78, slope: 1.4, latency: 3400, variance: 8 },
  carlos:  { count: 6,  base: 60, slope: -0.5, latency: 6600, variance: 12 },
  marta:   { count: 9,  base: 72, slope: 0.4, latency: 5100, variance: 6 },
  jorge:   { count: 4,  base: 48, slope: -1.2, latency: 7200, variance: 10 },
  rosa:    { count: 15, base: 84, slope: 0.8, latency: 3000, variance: 5 },
  alberto: { count: 7,  base: 64, slope: 0.6, latency: 4700, variance: 9 },
  lucia:   { count: 5,  base: 70, slope: 1.0, latency: 4100, variance: 7 },
  hector:  { count: 3,  base: 52, slope: -0.4, latency: 6200, variance: 11 }
};

// Rota entre actividades del banco para variar la skill.
const ACTIVITY_ROTATION = [
  { id: "market",    title: "Lista del supermercado",    skill: "Memoria de trabajo" },
  { id: "boleto",    title: "Pagar el boleto",           skill: "Atencion y calculo" },
  { id: "recipe",    title: "Ordenar una receta",        skill: "Funciones ejecutivas" },
  { id: "agenda",    title: "Agenda de turnos",          skill: "Orientacion temporal" },
  { id: "faces",     title: "Caras y nombres",           skill: "Memoria asociativa" },
  { id: "mood",      title: "Como me siento hoy",        skill: "Autorreporte" }
];

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

// Genera un set sintetico de sesiones por paciente para llenar la demo.
export function buildInitialSessions(now = new Date()) {
  const list = [];
  for (const [patientId, profile] of Object.entries(SYNTHETIC_PROFILES)) {
    const rand = seededRandom(patientId.length * 137 + profile.count);
    for (let i = 0; i < profile.count; i++) {
      const daysAgo = (profile.count - i) * 2 + Math.floor(rand() * 2);
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      const accuracyRaw = profile.base + profile.slope * i + (rand() - 0.5) * profile.variance * 2;
      const accuracy = Math.max(20, Math.min(100, Math.round(accuracyRaw)));
      const latency = Math.max(1500, Math.round(profile.latency + (rand() - 0.5) * 1600));
      const total = 5;
      const correct = Math.round((accuracy / 100) * total);
      const activity = ACTIVITY_ROTATION[i % ACTIVITY_ROTATION.length];
      list.push({
        id: `${patientId}-${activity.id}-${i}`,
        patientId,
        activityId: activity.id,
        activityTitle: activity.title,
        skill: activity.skill,
        date: date.toISOString(),
        correct,
        total,
        accuracy,
        avgLatencyMs: latency
      });
    }
  }
  return list;
}

export function computeStats(sessions) {
  if (sessions.length === 0) {
    return { count: 0, weekCount: 0, avgAccuracy: 0, avgLatencySec: "-", lastLabel: "sin registro" };
  }
  const weekCount = countSessionsThisWeek(sessions);
  const avgAccuracy = Math.round(averageField(sessions, "accuracy"));
  const avgLatencySec = (averageField(sessions, "avgLatencyMs") / 1000).toFixed(1);
  const last = sessions[sessions.length - 1];
  const lastLabel = formatShortDate(last.date);
  return { count: sessions.length, weekCount, avgAccuracy, avgLatencySec, lastLabel };
}
