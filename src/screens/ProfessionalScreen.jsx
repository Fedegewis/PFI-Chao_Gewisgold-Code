import { useMemo } from "react";
import { activities } from "../data/activities.js";
import { createNewProfessionalPatient, generatePatientId } from "../services/patientService.js";
import { computeStats, getPatientSessions } from "../services/sessionService.js";
import { PatientDetail } from "../components/professional/PatientDetail.jsx";
import { PatientGrid } from "../components/professional/PatientGrid.jsx";

function buildQuestionSample() {
  const seen = new Set();
  const sample = [];
  for (const activity of activities) {
    if (seen.has(activity.skill)) continue;
    seen.add(activity.skill);
    const first = activity.questions[0];
    if (!first) continue;
    sample.push(
      <article key={activity.id}>
        <strong>{activity.title}</strong>
        <p>{first.prompt}</p>
        <small>{activity.skill} · {first.clinician}</small>
      </article>
    );
    if (sample.length >= 5) break;
  }
  return sample;
}

export function ProfessionalScreen({
  patients,
  professionalId,
  selectedPatient,
  sessions,
  setPatients,
  setSelectedPatientId,
  updatePatient
}) {
  const patientSessions = useMemo(
    () => getPatientSessions(sessions, selectedPatient.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [sessions, selectedPatient.id]
  );
  const stats = useMemo(() => computeStats(patientSessions), [patientSessions]);
  const questionSample = useMemo(buildQuestionSample, []);

  function handleSelectPatient(patient) {
    setSelectedPatientId(patient.id);
  }

  function handleCreatePatient(trimmedName, parsedAge) {
    const nextPatientId = generatePatientId(trimmedName, patients.length + 1);
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
      <PatientGrid
        patients={patients}
        professionalId={professionalId}
        selectedPatient={selectedPatient}
        onSelectPatient={handleSelectPatient}
        onCreatePatient={handleCreatePatient}
      />
      <PatientDetail
        selectedPatient={selectedPatient}
        patientSessions={patientSessions}
        sessions={sessions}
        stats={stats}
        questionSample={questionSample}
        onSaveAiConfig={handleSaveAiConfig}
      />
    </div>
  );
}
