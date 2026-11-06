import { SECTION_SLUG_TO_ACTIVITY_ID } from "../constants/appConfig.js";
import { isSameCalendarDay } from "./patientService.js";

// 7H.2: deriva la lista de activity.id COMPLETADOS HOY (fecha local del
// dispositivo) a partir del historial devuelto por GET /api/patient/sessions.
// Regla: una sesión cuenta si:
//   - status === "completed"
//   - completed_at pertenece al día calendario actual (comparación local)
//   - alguna de sus sections tiene section_slug mapeable a activity.id.
// Duplicados: si el paciente completó dos sesiones de la misma actividad hoy,
// aparece una sola vez.
export function deriveCompletedTodayFromSessions(sessions, now = new Date()) {
  if (!Array.isArray(sessions)) return [];
  const activityIds = new Set();
  for (const session of sessions) {
    if (!session || session.status !== "completed") continue;
    if (!session.completed_at) continue;
    if (!isSameCalendarDay(session.completed_at, now)) continue;
    const sections = Array.isArray(session.sections) ? session.sections : [];
    for (const s of sections) {
      const activityId = SECTION_SLUG_TO_ACTIVITY_ID[s?.section_slug];
      if (activityId) activityIds.add(activityId);
    }
  }
  return [...activityIds];
}

// Progreso semanal del paciente backend: para la semana calendario actual
// (domingo a sábado, hora local, igual que DAY_LABELS y getDay()) devuelve un
// array de 7 con la cantidad de sesiones completadas cada día. Antes el panel
// leía `weeklyProgress` de localStorage, que para pacientes backend nunca se
// actualizaba (quedaba siempre en cero).
export function deriveWeeklyProgressFromSessions(sessions, now = new Date()) {
  const week = [0, 0, 0, 0, 0, 0, 0];
  if (!Array.isArray(sessions)) return week;
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  for (const session of sessions) {
    if (!session || session.status !== "completed" || !session.completed_at) continue;
    const date = new Date(session.completed_at);
    if (Number.isNaN(date.getTime()) || date < start || date >= end) continue;
    week[date.getDay()] += 1;
  }
  return week;
}

// 7H.2: fecha (Date | ISO string | null) del último completed_at de la lista.
// Alimenta patient.lastSessionAt para que refreshDailyPatientState siga
// funcionando exactamente igual que en modo demo.
export function latestCompletedAt(sessions) {
  if (!Array.isArray(sessions)) return null;
  let best = null;
  for (const session of sessions) {
    if (!session || session.status !== "completed" || !session.completed_at) continue;
    const t = new Date(session.completed_at).getTime();
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}
