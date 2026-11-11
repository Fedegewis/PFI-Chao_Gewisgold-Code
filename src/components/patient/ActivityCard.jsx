import { CheckCircle2, ChevronRight } from "lucide-react";
import { cx } from "../../lib/cx.js";

// opening: esta actividad se está preparando (creación de sesión en curso).
// busy: alguna actividad se está preparando; se bloquean todas para no crear
// sesiones duplicadas con toques repetidos.
export function ActivityCard({ activity, index, completed, onClick, opening = false, busy = false }) {
  const Icon = activity.icon;
  const statusLabel = completed ? "Completada" : opening ? "Preparando" : index === 0 ? "Recomendada" : activity.status;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={completed || busy}
      aria-busy={opening || undefined}
      className={cx("activity-card", index === 0 && !completed && "activity-recommended", completed && "activity-completed")}
      aria-label={`${activity.title}. ${activity.skill} - ${activity.time}. ${statusLabel}`}
    >
      <div className="activity-icon"><Icon size={32} aria-hidden="true" /></div>
      <div className="activity-copy"><span className="activity-status">{activity.status}</span><h3>{activity.title}</h3><p>{activity.skill} - {activity.time}</p>{completed && <strong className="done-badge"><CheckCircle2 size={18} aria-hidden="true" /> Hecha por hoy</strong>}{!completed && opening && <strong className="start-button" role="status">Preparando…</strong>}{!completed && !opening && index === 0 && <strong className="start-button">Comenzar</strong>}</div>
      <ChevronRight size={28} aria-hidden="true" />
    </button>
  );
}
