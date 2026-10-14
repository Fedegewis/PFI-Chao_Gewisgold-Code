

import { ActivityCard } from "../components/patient/ActivityCard.jsx";
import { GardenStrip } from "../components/patient/GardenStrip.jsx";
import { MoodPanel } from "../components/patient/MoodPanel.jsx";
import { PerformancePanel } from "../components/patient/PerformancePanel.jsx";
import { ProgressPanel } from "../components/patient/ProgressPanel.jsx";
import { ACTIVITY_TO_SECTION_SLUG } from "../constants/appConfig.js";

function computeStreak(weeklyProgress) {
  const today = new Date().getDay();
  let count = 0;
  for (let i = 0; i < 7; i++) {
    if (weeklyProgress[(today - i + 7) % 7] > 0) count++;
    else break;
  }
  return count;
}

// F3: cuando el controlador haya cargado availableSections (paciente backend),
// filtramos la lista para mostrar sólo las iniciables. Si availableSections es
// null (aún cargando o paciente no backend), mantenemos el comportamiento previo.
function filterStartableActivities(activities, availableSections) {
  if (!availableSections || !Array.isArray(availableSections.sections)) {
    return { startable: activities, hiddenCount: 0 };
  }
  const startableSlugs = new Set(
    availableSections.sections.filter((s) => s.startable).map((s) => s.section_slug)
  );
  const result = [];
  let hidden = 0;
  for (const a of activities) {
    const slug = ACTIVITY_TO_SECTION_SLUG[a.id];
    // Si no hay mapping backend, mantenemos la actividad (compatibilidad legacy).
    if (!slug) { result.push(a); continue; }
    if (startableSlugs.has(slug)) result.push(a);
    else hidden++;
  }
  return { startable: result, hiddenCount: hidden };
}

export function PatientScreen({ activities, motivationMessage, onOpenActivity, onUpdatePatient, patient, activityStartError, availableSections, availableSectionsError, isBackendPatient }) {
  const completedCount = patient.completed.length;
  const streak = computeStreak(patient.weeklyProgress);
  const { startable: visibleActivities, hiddenCount } = filterStartableActivities(activities, availableSections);
  const noneAvailable = availableSections && visibleActivities.length === 0;

  return (
    <div className="patient-layout">
      <section className="panel patient-main" aria-label="Actividades del paciente">
        <div className="garden-welcome"><span>Hola, {patient.name.split(" ")[0]}. {motivationMessage}</span></div>
        <GardenStrip activities={visibleActivities} completedIds={patient.completed} />
        <div className="section-head"><div><p className="eyebrow">Tu entrenamiento de hoy</p><h2>Actividades disponibles</h2></div><span className="streak-pill">Continuidad: {streak} {streak === 1 ? "día" : "días"}</span></div>
        {activityStartError && (
          <div className="error-box" role="alert">{activityStartError}</div>
        )}
        {noneAvailable && (
          <div className="error-box" role="alert">
            No hay actividades disponibles con la configuración actual. Hablá con tu profesional.
          </div>
        )}
        {!noneAvailable && hiddenCount > 0 && (
          <p className="ai-hint">
            {hiddenCount === 1
              ? "Hay 1 actividad oculta porque no cumple con la configuración vigente."
              : `Hay ${hiddenCount} actividades ocultas porque no cumplen con la configuración vigente.`}
          </p>
        )}
        <div className="activity-grid" role="list" aria-label="Lista de actividades">
          {visibleActivities.map((activity, index) => <ActivityCard key={activity.id} activity={activity} index={index} completed={patient.completed.includes(activity.id)} onClick={() => onOpenActivity(activity)} />)}
        </div>
      </section>
      <aside className="patient-aside" aria-label="Panel del paciente">
        <PerformancePanel
          patient={patient}
          completedCount={completedCount}
          totalActivities={activities.length}
          availableSections={availableSections}
          availableSectionsError={availableSectionsError}
          isBackendPatient={isBackendPatient}
        />
        <MoodPanel patient={patient} onUpdatePatient={onUpdatePatient} />
        <ProgressPanel patient={patient} completedCount={completedCount} />
      </aside>
    </div>
  );
}
