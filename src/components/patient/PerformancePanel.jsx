import { Trophy } from "lucide-react";

export function PerformancePanel({ patient, completedCount, totalActivities }) {
  const percent = Math.round((completedCount / totalActivities) * 100);
  return (
    <div className="panel performance-panel">
      <div className="performance-head"><Trophy className="theme-icon" size={30} /><div><h3>Mi rendimiento</h3><p>Tu jardin crece con cada actividad completada.</p></div></div>
      <div className="performance-ring" style={{ "--value": `${percent}%` }}>
        <div className="performance-ring-center">
          <strong>{percent}%</strong>
          <span>completado</span>
        </div>
      </div>
      <p className="performance-count">{completedCount} de {totalActivities} actividades hechas hoy</p>
      <p className="performance-note">Cantidad maxima definida por el psicologo: {patient.maxQuestions} preguntas.</p>
    </div>
  );
}
