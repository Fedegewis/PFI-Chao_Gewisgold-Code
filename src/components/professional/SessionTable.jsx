import { formatLatency, formatShortDate } from "../../lib/format.js";

export function SessionTable({ sessions }) {
  if (sessions.length === 0) return null;
  const recent = [...sessions].slice(-5).reverse();
  return (
    <div className="session-table-wrap">
      <div className="session-table" role="table" aria-label="Sesiones recientes">
        <div className="session-table-head" role="row">
          <span role="columnheader" scope="col">Fecha</span>
          <span role="columnheader" scope="col">Actividad</span>
          <span role="columnheader" scope="col">Aciertos</span>
          <span role="columnheader" scope="col">Latencia</span>
        </div>
        <div role="rowgroup">
          {recent.map((session) => (
            <div key={session.id} className="session-table-row" role="row">
              <span role="cell">{formatShortDate(session.date)}</span>
              <span role="cell">{session.activityTitle}</span>
              <span role="cell">{session.accuracy}%</span>
              <span role="cell">{formatLatency(session.avgLatencyMs)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
