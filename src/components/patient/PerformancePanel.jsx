import { Trophy } from "lucide-react";

export function PerformancePanel({ patient, completedCount, totalActivities }) {
  const percent = Math.round((completedCount / totalActivities) * 100);
  return (
    <div className="panel performance-panel">
      <div className="performance-head"><Trophy className="theme-icon" size={30} aria-hidden="true" /><div><h3>Mi rendimiento</h3><p>Tu jardín crece con cada actividad completada.</p></div></div>
      <div className="performance-ring" role="img" aria-label={`${percent}% completado, ${completedCount} de ${totalActivities} actividades`} style={{ "--value": `${percent}%` }}>
        <div className="performance-ring-center" aria-hidden="true">
          <strong>{percent}%</strong>
          <span>completado</span>
        </div>
      </div>
      <p className="performance-count">{completedCount} de {totalActivities} actividades hechas hoy</p>
      <p className="performance-note">Cantidad máxima definida por el psicólogo: {patient.maxQuestions} preguntas.</p>
    </div>
  );
}
