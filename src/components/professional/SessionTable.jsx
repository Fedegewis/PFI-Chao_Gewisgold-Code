import { formatLatency, formatShortDate } from "../../lib/format.js";

export function SessionTable({ sessions }) {
  if (sessions.length === 0) return null;
  const recent = [...sessions].slice(-5).reverse();
  return (
    <div className="session-table">
      <div className="session-table-head"><span>Fecha</span><span>Actividad</span><span>Aciertos</span><span>Latencia</span></div>
      {recent.map((session) => (
        <div key={session.id} className="session-table-row">
          <span>{formatShortDate(session.date)}</span>
          <span>{session.activityTitle}</span>
          <span>{session.accuracy}%</span>
          <span>{formatLatency(session.avgLatencyMs)}</span>
        </div>
      ))}
    </div>
  );
}
