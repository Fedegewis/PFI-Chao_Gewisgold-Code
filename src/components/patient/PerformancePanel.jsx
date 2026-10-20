import { Activity } from "lucide-react";
import { MedicalDisclaimerNote } from "../common/MedicalDisclaimer.jsx";

// BUG-08: la cantidad máxima debe reflejar la configuración REAL que usa el
// backend para generar sesiones (users.max_questions), no un default local.
// Fuente de verdad: availableSections.requested (GET /api/patient/available-sections)
// → mismo cálculo que el selector server-side.
//
// isBackendPatient = true: SIEMPRE depender de availableSections. Nunca
//   mostrar patient.maxQuestions local (puede ser el default 4 de localStorage).
// isBackendPatient = false (modo demo, sin backend): usar el valor local.
function resolveMaxQuestionsLabel({ patient, availableSections, availableSectionsError, isBackendPatient }) {
  if (availableSections && Number.isInteger(availableSections.requested)) {
    return { kind: "value", value: availableSections.requested };
  }
  if (availableSectionsError) {
    return { kind: "error" };
  }
  if (!isBackendPatient && patient && Number.isInteger(patient.maxQuestions)) {
    return { kind: "value", value: patient.maxQuestions };
  }
  return { kind: "loading" };
}

export function PerformancePanel({ patient, completedCount, totalActivities, availableSections, availableSectionsError, isBackendPatient = false }) {
  const percent = Math.round((completedCount / totalActivities) * 100);
  const maxQ = resolveMaxQuestionsLabel({ patient, availableSections, availableSectionsError, isBackendPatient });
  return (
    <div className="panel performance-panel">
      <div className="performance-head"><Activity className="theme-icon" size={30} aria-hidden="true" /><div><h3>Mi rendimiento</h3><p>Tu progreso avanza con cada actividad.</p></div></div>
      <div className="performance-ring" role="img" aria-label={`${percent}% completado, ${completedCount} de ${totalActivities} actividades`} style={{ "--value": `${percent}%` }}>
        <div className="performance-ring-center" aria-hidden="true">
          <strong>{percent}%</strong>
          <span>completado</span>
        </div>
      </div>
      <p className="performance-count">{completedCount} de {totalActivities} actividades hechas hoy</p>
      <MedicalDisclaimerNote />
      {maxQ.kind === "value" && (
        <p className="performance-note">Cantidad máxima definida por el psicólogo: {maxQ.value} preguntas.</p>
      )}
      {maxQ.kind === "loading" && (
        <p className="performance-note">Cargando la configuración de tu profesional…</p>
      )}
      {maxQ.kind === "error" && (
        <p className="performance-note">No pudimos cargar la cantidad definida por tu profesional en este momento.</p>
      )}
    </div>
  );
}
