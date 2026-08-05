import { SLOW_MS } from "../constants/appConfig.js";
import { formatLatency, formatShortDate } from "../lib/format.js";

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
  const avgAccuracy = Math.round(patientSessions.reduce((sum, item) => sum + item.accuracy, 0) / patientSessions.length);
  const avgLatencyMs = Math.round(patientSessions.reduce((sum, item) => sum + item.avgLatencyMs, 0) / patientSessions.length);
  const previousSessions = patientSessions.slice(0, -1);
  const previousAvg = previousSessions.length
    ? Math.round(previousSessions.reduce((sum, item) => sum + item.accuracy, 0) / previousSessions.length)
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
      rt: formatLatency(avgLatencyMs),
      risk: session.avgLatencyMs > SLOW_MS || session.accuracy < 50 ? "Medio" : "Bajo",
      weeklyProgress: nextWeeklyProgress,
      lastSessionAt: session.date
    }
  };
}

export function computeStats(sessions) {
  if (sessions.length === 0) {
    return { count: 0, weekCount: 0, avgAccuracy: 0, avgLatencySec: "-", lastLabel: "sin registro" };
  }
  const weekCount = countSessionsThisWeek(sessions);
  const avgAccuracy = Math.round(sessions.reduce((sum, session) => sum + session.accuracy, 0) / sessions.length);
  const avgLatencySec = (sessions.reduce((sum, session) => sum + session.avgLatencyMs, 0) / sessions.length / 1000).toFixed(1);
  const last = sessions[sessions.length - 1];
  const lastLabel = formatShortDate(last.date);
  return { count: sessions.length, weekCount, avgAccuracy, avgLatencySec, lastLabel };
}
