

import { ActivityCard } from "../components/patient/ActivityCard.jsx";
import { AiChatPanel } from "../components/patient/AiChatPanel.jsx";
import { GardenStrip } from "../components/patient/GardenStrip.jsx";
import { MoodPanel } from "../components/patient/MoodPanel.jsx";
import { PerformancePanel } from "../components/patient/PerformancePanel.jsx";
import { ProgressPanel } from "../components/patient/ProgressPanel.jsx";

function computeStreak(weeklyProgress) {
  const today = new Date().getDay();
  let count = 0;
  for (let i = 0; i < 7; i++) {
    if (weeklyProgress[(today - i + 7) % 7] > 0) count++;
    else break;
  }
  return count;
}

export function PatientScreen({ activities, motivationMessage, onOpenActivity, onUpdatePatient, patient }) {
  const completedCount = patient.completed.length;
  const streak = computeStreak(patient.weeklyProgress);

  return (
    <div className="patient-layout">
      <section className="panel patient-main" aria-label="Actividades del paciente">
        <div className="garden-welcome"><span>Hola, {patient.name.split(" ")[0]}. {motivationMessage}</span></div>
        <GardenStrip activities={activities} completedIds={patient.completed} />
        <div className="section-head"><div><p className="eyebrow">Tu entrenamiento de hoy</p><h2>Actividades disponibles</h2></div><span className="streak-pill">Continuidad: {streak} {streak === 1 ? "día" : "días"}</span></div>
        <div className="activity-grid" role="list" aria-label="Lista de actividades">
          {activities.map((activity, index) => <ActivityCard key={activity.id} activity={activity} index={index} completed={patient.completed.includes(activity.id)} onClick={() => onOpenActivity(activity)} />)}
        </div>
      </section>
      <aside className="patient-aside" aria-label="Panel del paciente">
        <PerformancePanel patient={patient} completedCount={completedCount} totalActivities={activities.length} />
        <MoodPanel patient={patient} onUpdatePatient={onUpdatePatient} />
        <AiChatPanel patient={patient} />
        <ProgressPanel patient={patient} completedCount={completedCount} />
      </aside>
    </div>
  );
}
