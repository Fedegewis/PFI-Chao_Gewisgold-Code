import { Activity, BarChart3, CalendarDays, CheckCircle2, Timer, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { activities } from "../data/activities.js";
import { createNewProfessionalPatient, slugifyPatientName } from "../services/patientService.js";
import { computeStats, getPatientSessions } from "../services/sessionService.js";
import { AiConfigPanel } from "../components/professional/AiConfigPanel.jsx";
import { AiObservation } from "../components/professional/AiObservation.jsx";
import { EvolutionChart } from "../components/professional/EvolutionChart.jsx";
import { PatientSidebar } from "../components/professional/PatientSidebar.jsx";
import { SessionTable } from "../components/professional/SessionTable.jsx";
import { MetricCard } from "../components/common/MetricCard.jsx";

export function ProfessionalScreen({
  patients,
  professionalId,
  selectedPatient,
  sessions,
  setPatients,
  setSelectedPatientId,
  updatePatient,
  resetDemo
}) {
  const patientSessions = useMemo(
    () => getPatientSessions(sessions, selectedPatient.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [sessions, selectedPatient.id]
  );
  const stats = useMemo(() => computeStats(patientSessions), [patientSessions]);
  const questionBank = useMemo(
    () => activities.flatMap((activity) =>
      activity.questions.map((question, index) => (
        <article key={`${activity.id}-${index}`}>
          <strong>{activity.title}</strong>
          <p>{question.prompt}</p>
          <small>{question.clinician}</small>
        </article>
      ))
    ),
    []
  );

  function handleSelectPatient(patient) {
    setSelectedPatientId(patient.id);
  }

  function handleCreatePatient(trimmedName, parsedAge) {
    const nextPatientId = slugifyPatientName(trimmedName) || `paciente-${patients.length + 1}`;
    const nextPatient = createNewProfessionalPatient({
      patientId: nextPatientId,
      name: trimmedName,
      age: parsedAge,
      professionalId
    });
    setPatients((current) => [...current, nextPatient]);
    setSelectedPatientId(nextPatient.id);
  }

  function handleSaveAiConfig(instructions, maxQuestions) {
    updatePatient(selectedPatient.id, { aiInstructions: instructions, maxQuestions });
  }

  return (
    <div className="professional-layout">
      <PatientSidebar
        patients={patients}
        professionalId={professionalId}
        selectedPatient={selectedPatient}
        onSelectPatient={handleSelectPatient}
        onCreatePatient={handleCreatePatient}
        onResetDemo={resetDemo}
      />
      <section className="professional-stack" aria-label={`Datos de ${selectedPatient.name}`}>
        <div className="metric-grid">
          <MetricCard icon={CheckCircle2} label="Aciertos" value={stats.count ? `${stats.avgAccuracy}%` : `${selectedPatient.score}%`} detail={selectedPatient.trend} />
          <MetricCard icon={Timer} label="Tiempo medio" value={stats.count ? `${stats.avgLatencySec} s` : selectedPatient.rt} detail="respuesta" />
          <MetricCard icon={Activity} label="Riesgo" value={selectedPatient.risk} detail="preventivo" />
          <MetricCard icon={CalendarDays} label="Sesiones" value={`${stats.count}`} detail={`${stats.weekCount} esta semana`} />
        </div>
        <div className="panel">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Evolucion del rendimiento</p>
              <h2>Precision por sesion</h2>
            </div>
            <TrendingUp size={30} aria-hidden="true" />
          </div>
          <EvolutionChart sessions={patientSessions} />
          <SessionTable sessions={patientSessions} />
        </div>
        <AiObservation patient={selectedPatient} sessions={sessions} />
        <AiConfigPanel selectedPatient={selectedPatient} onSave={handleSaveAiConfig} />
        <div className="panel">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Dentro de cada paciente</p>
              <h2>Preguntas que se hacen</h2>
            </div>
            <BarChart3 size={30} aria-hidden="true" />
          </div>
          <div className="question-bank" role="feed" aria-label="Banco de preguntas">
            {questionBank}
          </div>
        </div>
      </section>
    </div>
  );
}
