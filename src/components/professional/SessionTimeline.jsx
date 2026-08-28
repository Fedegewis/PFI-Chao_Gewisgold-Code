import { Clock3 } from "lucide-react";
import { formatShortDate } from "../../lib/format.js";
import { cx } from "../../lib/cx.js";

function scoreTone(accuracy) {
  if (accuracy >= 75) return "timeline-score--good";
  if (accuracy >= 55) return "timeline-score--mid";
  return "timeline-score--low";
}

export function SessionTimeline({ sessions }) {
  if (!sessions.length) {
    return (
      <div className="timeline-empty">
        <Clock3 size={18} aria-hidden="true" />
        <span>Cuando se registren sesiones vas a ver acá la línea de tiempo del paciente.</span>
      </div>
    );
  }
  const ordered = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="timeline">
      <ol className="timeline-list timeline-list--capped" aria-label="Línea de tiempo de sesiones">
        {ordered.map((session) => (
          <li key={session.id} className="timeline-item">
            <span className="timeline-dot" aria-hidden="true" />
            <div className="timeline-content">
              <div className="timeline-head">
                <strong>{session.activityTitle}</strong>
                <span className={cx("timeline-score", scoreTone(session.accuracy))}>{session.accuracy}%</span>
              </div>
              <p className="timeline-meta">
                <span>{formatShortDate(session.date)}</span>
                <span aria-hidden="true">·</span>
                <span>{session.skill}</span>
                <span aria-hidden="true">·</span>
                <span>{(session.avgLatencyMs / 1000).toFixed(1)} s</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
