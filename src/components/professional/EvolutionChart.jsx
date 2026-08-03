import { EMPTY_CHART_MESSAGE } from "../../constants/content.js";
import { cx } from "../../lib/cx.js";

export function EvolutionChart({ sessions }) {
  if (sessions.length === 0) {
    return <div className="empty-chart">{EMPTY_CHART_MESSAGE}</div>;
  }
  const recent = sessions.slice(-8);
  return (
    <div className="evolution-bars">
      {recent.map((session) => (
        <div key={session.id} className="evolution-slot">
          <span className="evolution-value">{session.accuracy}%</span>
          <span
            className={cx("evolution-bar", session.accuracy >= 70 ? "bar-high" : session.accuracy >= 50 ? "bar-mid" : "bar-low")}
            style={{ height: `${Math.max(8, session.accuracy)}%` }}
            title={`${session.activityTitle} - ${session.accuracy}% - ${(session.avgLatencyMs / 1000).toFixed(1)} s`}
          />
          <small>{new Date(session.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</small>
        </div>
      ))}
    </div>
  );
}
