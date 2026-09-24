import { Activity, BarChart3, CalendarDays, Clock3, Target, Timer, TrendingUp, User } from "lucide-react";
import { MetricCard } from "../common/MetricCard.jsx";
import { AiConfigPanel } from "./AiConfigPanel.jsx";
import { AiObservation } from "./AiObservation.jsx";
import { EvolutionChart } from "./EvolutionChart.jsx";
import { SessionTable } from "./SessionTable.jsx";
import { SessionTimeline } from "./SessionTimeline.jsx";

export function PatientDetail({
  selectedPatient,
  patientSessions,
  sessions,
  stats,
  questionSample,
  onSaveAiConfig
}) {
  const hasScore = (selectedPatient.score ?? 0) > 0;
  const precisionValue = stats.count
    ? `${stats.avgAccuracy}%`
    : hasScore
      ? `${selectedPatient.score}%`
      : "—";
  const rawLatency = selectedPatient.responseTime;
  const latencyValue = stats.count
    ? `${stats.avgLatencySec} s`
    : rawLatency && rawLatency !== "-"
      ? rawLatency
      : "—";
  const trendValue = selectedPatient.trend && selectedPatient.trend !== "0%" ? selectedPatient.trend : "Sin datos";
  const riskValue = hasScore || stats.count ? selectedPatient.risk : "Sin datos";

  return (
    <section className="professional-detail" aria-label={`Datos de ${selectedPatient.name}`}>
      <header className="detail-topbar">
        <div>
          <p className="eyebrow">Ficha del usuario</p>
          <h2>{selectedPatient.name}</h2>
          <small>{selectedPatient.age} años · {selectedPatient.note}</small>
        </div>
      </header>

      <div className="metric-grid">
        <MetricCard icon={User} label="Usuario" value={selectedPatient.name.split(" ")[0]} detail={`${selectedPatient.age} años`} />
        <MetricCard icon={Target} label="Precisión" value={precisionValue} detail={trendValue} />
        <MetricCard icon={Timer} label="Tiempo medio" value={latencyValue} detail="respuesta" />
        <MetricCard icon={Activity} label="Riesgo" value={riskValue} detail="preventivo" />
        <MetricCard icon={CalendarDays} label="Sesiones" value={`${stats.count}`} detail={`${stats.weekCount} esta semana`} />
      </div>

      <div className="detail-columns">
        <div className="detail-col">
          <div className="panel">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Evolucion del rendimiento</p>
                <h3>Precisión por sesión</h3>
              </div>
              <TrendingUp size={26} aria-hidden="true" />
            </div>
            <EvolutionChart sessions={patientSessions} />
            <SessionTable sessions={patientSessions} />
          </div>
          <div className="panel">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Últimas actividades</p>
                <h3>Línea de tiempo</h3>
              </div>
              <Clock3 size={22} aria-hidden="true" />
            </div>
            <SessionTimeline sessions={patientSessions} />
          </div>
        </div>

        <div className="detail-col">
          <AiObservation patient={selectedPatient} sessions={sessions} />
          <AiConfigPanel selectedPatient={selectedPatient} onSave={onSaveAiConfig} />
        </div>
      </div>

      <div className="panel">
        <div className="section-head compact">
          <div>
            <p className="eyebrow">Muestra de preguntas</p>
            <h3>Ejemplos por dominio</h3>
          </div>
          <BarChart3 size={26} aria-hidden="true" />
        </div>
        <p className="questions-note">
          Muestra representativa de los dominios que trabaja el paciente. Próximamente cada usuario tendrá las preguntas que ha respondido.
        </p>
        <div className="question-bank question-bank-horizontal" role="feed" aria-label="Muestra de preguntas por dominio">
          {questionSample}
        </div>
      </div>
    </section>
  );
}
