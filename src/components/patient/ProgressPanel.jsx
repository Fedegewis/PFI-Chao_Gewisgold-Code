import { DAY_LABELS } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";

const RING_SIZE = 132;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export function ProgressPanel({ patient, completedCount }) {
  const todayIndex = new Date().getDay();
  const values = patient.weeklyProgress;
  const activeDays = values.filter((v) => v > 0).length;
  const average = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const dashOffset = RING_CIRC * (1 - average / 100);
  const ariaLabel = `Progreso semanal: ${average}% promedio. ${DAY_LABELS.map((d, i) => `${d} ${values[i]}%`).join(", ")}`;

  return (
    <div className="panel">
      <h3 id="weekly-progress-heading">Progreso semanal</h3>
      <div className="week-summary" role="img" aria-label={ariaLabel}>
        <div className="week-ring">
          <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="#e4ecdf"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="url(#week-ring-gradient)"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              style={{ transition: "stroke-dashoffset 480ms ease" }}
            />
            <defs>
              <linearGradient id="week-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8fb283" />
                <stop offset="100%" stopColor="#3f7d68" />
              </linearGradient>
            </defs>
          </svg>
          <div className="week-ring-center">
            <strong>{average}%</strong>
            <span>Semana</span>
          </div>
        </div>
        <div className="week-meta">
          <p className="week-active">
            <strong>{activeDays}</strong>/7 dias activos
          </p>
          <div className="week-dots" aria-hidden="true">
            {values.map((value, index) => (
              <div key={`${DAY_LABELS[index]}-${index}`} className="week-dot-slot">
                <span
                  className={cx(
                    "week-dot",
                    value > 0 && "week-dot--filled",
                    index === todayIndex && "week-dot--today"
                  )}
                  style={{ "--fill": `${Math.min(100, value)}%` }}
                />
                <small>{DAY_LABELS[index]}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="week-caption">
        {completedCount > 0
          ? `Ya completaste ${completedCount} actividad${completedCount === 1 ? "" : "es"} hoy.`
          : "Todavia no completaste actividades hoy."}
      </p>
    </div>
  );
}
