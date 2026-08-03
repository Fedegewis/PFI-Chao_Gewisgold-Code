export function SessionTable({ sessions }) {
  if (sessions.length === 0) return null;
  const recent = [...sessions].slice(-5).reverse();
  return (
    <div className="session-table">
      <div className="session-table-head"><span>Fecha</span><span>Actividad</span><span>Aciertos</span><span>Latencia</span></div>
      {recent.map((session) => (
        <div key={session.id} className="session-table-row">
          <span>{new Date(session.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</span>
          <span>{session.activityTitle}</span>
          <span>{session.accuracy}%</span>
          <span>{(session.avgLatencyMs / 1000).toFixed(1)} s</span>
        </div>
      ))}
    </div>
  );
}
