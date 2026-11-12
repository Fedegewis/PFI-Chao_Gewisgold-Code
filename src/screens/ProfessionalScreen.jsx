import { useMemo } from "react";
import { activities } from "../data/activities.js";
import { computeStats, getPatientSessions } from "../services/sessionService.js";
import { BackendPatientDetail } from "../components/professional/BackendPatientDetail.jsx";
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

// Primer nombre del profesional autenticado; null si no hay nombre disponible.
function getFirstName(fullName) {
  if (typeof fullName !== "string") return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first || null;
}

export function ProfessionalScreen({
  professionalName,
  patients,
  professionalId,
  selectedPatient,
  sessions,
  setSelectedPatientId,
  updatePatient,
  isBackendProfessional,
  deletePatientForProfessional,
  deleteSessionForProfessional,
  backendPatientSessions,
  refreshPatients
}) {
  const patientSessions = useMemo(
    () =>
      selectedPatient
        ? getPatientSessions(sessions, selectedPatient.id).sort((a, b) => new Date(a.date) - new Date(b.date))
        : [],
    [sessions, selectedPatient]
  );
  const stats = useMemo(() => computeStats(patientSessions), [patientSessions]);
  const questionSample = useMemo(buildQuestionSample, []);
  const firstName = getFirstName(professionalName);

  function handleSelectPatient(patient) {
    setSelectedPatientId(patient.id);
  }

  async function handleDeletePatient() {
    if (!selectedPatient || !isBackendProfessional || !deletePatientForProfessional) return;
    await deletePatientForProfessional(selectedPatient.id);
  }

  function handleSaveAiConfig(instructions, maxQuestions, activeDomains) {
    if (!selectedPatient) return;
    updatePatient(selectedPatient.id, { aiInstructions: instructions, maxQuestions, activeDomains });
  }

  return (
    <div className="professional-layout">
      <p className="professional-greeting" data-testid="professional-greeting">
        {firstName ? `Hola, ${firstName}` : "Hola"}
      </p>
      <PatientGrid
        patients={patients}
        professionalId={professionalId}
        selectedPatient={selectedPatient}
        onSelectPatient={handleSelectPatient}
        useBackendScope={isBackendProfessional}
        onRefreshPatients={refreshPatients}
      />
      {selectedPatient ? (
        isBackendProfessional ? (
          <BackendPatientDetail
            selectedPatient={selectedPatient}
            sessionsState={backendPatientSessions}
            onDeletePatient={handleDeletePatient}
            onDeleteSession={isBackendProfessional ? deleteSessionForProfessional : null}
          />
        ) : (
          <PatientDetail
            selectedPatient={selectedPatient}
            patientSessions={patientSessions}
            sessions={sessions}
            stats={stats}
            questionSample={questionSample}
            onSaveAiConfig={handleSaveAiConfig}
            onDeletePatient={null}
          />
        )
      ) : (
        <section className="professional-detail" aria-label="Sin paciente seleccionado">
          <div className="panel">
            <p className="eyebrow">Ficha del usuario</p>
            <h2>Ningún paciente seleccionado</h2>
            <p>
              {patients.length === 0
                ? "Todavía no tenés pacientes cargados. Usá \"Invitar paciente\" para enviar la primera invitación."
                : "Seleccioná un paciente de la lista para ver su ficha, métricas y evolución."}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
