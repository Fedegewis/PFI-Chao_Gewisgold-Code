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
