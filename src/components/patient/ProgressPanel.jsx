import { DAY_LABELS } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";

const RING_SIZE = 132;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Progreso semanal = días de la semana actual (domingo a sábado) con al menos
// una actividad completada. `weeklyProgress` trae un valor por día: para
// pacientes backend, la cantidad de sesiones completadas ese día; en la demo,
// el porcentaje acumulado. En ambos casos sólo importa si es mayor que cero.
// No se usa un porcentaje: hacer pocas actividades por día no "baja" la semana.
export function ProgressPanel({ patient, completedCount }) {
  const todayIndex = new Date().getDay();
  const values = Array.isArray(patient.weeklyProgress) && patient.weeklyProgress.length === 7
    ? patient.weeklyProgress
    : [0, 0, 0, 0, 0, 0, 0];
  const activeFlags = values.map((v) => Number(v) > 0);
  const activeDays = activeFlags.filter(Boolean).length;
  const dashOffset = RING_CIRC * (1 - activeDays / 7);
  const activeNames = DAY_NAMES.filter((_, i) => activeFlags[i]);
  const ariaLabel = `Progreso semanal: ${activeDays} de 7 días con actividad.${
    activeNames.length ? ` Días con actividad: ${activeNames.join(", ")}.` : ""
  }`;

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
            {activeDays > 0 && (
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
            )}
            <defs>
              <linearGradient id="week-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8fb283" />
                <stop offset="100%" stopColor="#3f7d68" />
              </linearGradient>
            </defs>
          </svg>
          <div className="week-ring-center">
            <strong>{activeDays}/7</strong>
            <span>Días</span>
          </div>
        </div>
        <div className="week-meta">
          <p className="week-active">
            {activeDays === 0
              ? "Esta semana todavía no hay días con actividad."
              : `${activeDays === 1 ? "1 día" : `${activeDays} días`} con actividad esta semana.`}
          </p>
          <div className="week-dots" aria-hidden="true">
            {activeFlags.map((active, index) => (
              <div key={`${DAY_LABELS[index]}-${index}`} className="week-dot-slot">
                <span
                  className={cx(
                    "week-dot",
                    active && "week-dot--filled",
                    index === todayIndex && "week-dot--today"
                  )}
                  style={{ "--fill": active ? "100%" : "0%" }}
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
          : "Todavía no completaste actividades hoy."}
      </p>
    </div>
  );
}
