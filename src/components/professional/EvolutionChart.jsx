import { useEffect, useRef, useState } from "react";
import { EMPTY_CHART_MESSAGE } from "../../constants/content.js";
import { formatLatency, formatShortDate } from "../../lib/format.js";
import { cx } from "../../lib/cx.js";

export function EvolutionChart({ sessions }) {
  const barsRef = useRef(null);
  const [overflow, setOverflow] = useState(false);
  const recent = sessions.length === 0 ? null : sessions.slice(-8);

  useEffect(() => {
    const el = barsRef.current;
    if (!el) return undefined;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recent]);

  if (!recent) {
    return <div className="empty-chart">{EMPTY_CHART_MESSAGE}</div>;
  }

  return (
    <>
      <div className="sr-only">
        Grafico de evolucion: {recent.map((s) => `${formatShortDate(s.date)}: ${s.activityTitle}, ${s.accuracy}% de aciertos, ${formatLatency(s.avgLatencyMs)} de latencia`).join(". ")}.
      </div>
      <div className="evolution-bars" ref={barsRef} aria-hidden="true">
        {recent.map((session) => (
          <div key={session.id} className="evolution-slot">
            <span className="evolution-value">{session.accuracy}%</span>
            <span
              className={cx("evolution-bar", session.accuracy >= 70 ? "bar-high" : session.accuracy >= 50 ? "bar-mid" : "bar-low")}
              style={{ height: `${Math.max(8, session.accuracy)}%` }}
              title={`${session.activityTitle} - ${session.accuracy}% - ${formatLatency(session.avgLatencyMs)}`}
            />
            <small>{formatShortDate(session.date)}</small>
          </div>
        ))}
      </div>
      {overflow && (
        <p className="scroll-hint" aria-hidden="true">Deslizá para ver más sesiones →</p>
      )}
    </>
  );
}
