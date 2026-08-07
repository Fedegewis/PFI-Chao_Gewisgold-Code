import { DAY_LABELS } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";

export function ProgressPanel({ patient, completedCount }) {
  const todayIndex = new Date().getDay();

  return (
    <div className="panel">
      <h3 id="weekly-progress-heading">Progreso semanal</h3>
      <div className="mini-bars" role="img" aria-label={`Progreso semanal: ${DAY_LABELS.map((day, i) => `${day} ${patient.weeklyProgress[i]}%`).join(", ")}`}>
        {patient.weeklyProgress.map((value, index) => (
          <div key={`${DAY_LABELS[index]}-${index}`} className="mini-bar-slot" aria-hidden="true">
            <span className={cx("mini-bar", index === todayIndex && "mini-bar-today")} style={{ height: `${Math.max(16, value)}%` }} />
            <small>{DAY_LABELS[index]}</small>
          </div>
        ))}
      </div>
      <p>{completedCount > 0 ? `Ya completaste ${completedCount} actividad${completedCount === 1 ? "" : "es"} hoy.` : "Todavia no completaste actividades hoy."}</p>
    </div>
  );
}
