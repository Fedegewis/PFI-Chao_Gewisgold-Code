import { CheckCircle2, ChevronRight } from "lucide-react";
import { cx } from "../../lib/cx.js";

export function ActivityCard({ activity, index, completed, onClick }) {
  const Icon = activity.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={completed}
      className={cx("activity-card", index === 0 && !completed && "activity-recommended", completed && "activity-completed")}
      aria-label={`${activity.title}. ${activity.skill} - ${activity.time}. ${completed ? "Completada" : index === 0 ? "Recomendada" : activity.status}`}
    >
      <div className="activity-icon"><Icon size={32} aria-hidden="true" /></div>
      <div className="activity-copy"><span className="activity-status">{activity.status}</span><h3>{activity.title}</h3><p>{activity.skill} - {activity.time}</p>{completed && <strong className="done-badge"><CheckCircle2 size={18} aria-hidden="true" /> Hecha por hoy</strong>}{!completed && index === 0 && <strong className="start-button">Comenzar</strong>}</div>
      <ChevronRight size={28} aria-hidden="true" />
    </button>
  );
}
