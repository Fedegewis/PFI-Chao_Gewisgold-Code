import { useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { formatShortDate } from "../../lib/format.js";
import { cx } from "../../lib/cx.js";

const PREVIEW = 5;

function scoreTone(accuracy) {
  if (accuracy >= 75) return "timeline-score--good";
  if (accuracy >= 55) return "timeline-score--mid";
  return "timeline-score--low";
}

export function SessionTimeline({ sessions }) {
  const [expanded, setExpanded] = useState(false);
  if (!sessions.length) {
    return (
      <div className="timeline-empty">
        <Clock3 size={18} aria-hidden="true" />
        <span>Cuando se registren sesiones vas a ver acá la línea de tiempo del paciente.</span>
      </div>
    );
  }
  const ordered = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
  const visible = expanded ? ordered : ordered.slice(0, PREVIEW);
  const hidden = ordered.length - visible.length;

  return (
    <div className="timeline">
      <ol className="timeline-list" aria-label="Línea de tiempo de sesiones">
        {visible.map((session) => (
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
      {ordered.length > PREVIEW && (
        <button
          type="button"
          className="timeline-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "Ver menos" : `Ver todos (${hidden} más)`}
          <ChevronDown size={16} aria-hidden="true" className={cx("timeline-chevron", expanded && "timeline-chevron--open")} />
        </button>
      )}
    </div>
  );
}
