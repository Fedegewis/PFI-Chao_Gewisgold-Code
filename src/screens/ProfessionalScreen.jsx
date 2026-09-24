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
  updatePatient,
  isBackendProfessional,
  createPatientForProfessional,
  deletePatientForProfessional
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

  function handleSelectPatient(patient) {
    setSelectedPatientId(patient.id);
  }

  async function handleCreatePatient(trimmedName, parsedAge) {
    if (isBackendProfessional) {
      const slug = generatePatientId(trimmedName, patients.length + 1);
      const email = `${slug}-${Date.now()}@menteactiva.local`;
      await createPatientForProfessional({ name: trimmedName, age: parsedAge, email });
      return;
    }
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
      <PatientGrid
        patients={patients}
        professionalId={professionalId}
        selectedPatient={selectedPatient}
        onSelectPatient={handleSelectPatient}
        onCreatePatient={handleCreatePatient}
        useBackendScope={isBackendProfessional}
      />
      {selectedPatient ? (
        <PatientDetail
          selectedPatient={selectedPatient}
          patientSessions={patientSessions}
          sessions={sessions}
          stats={stats}
          questionSample={questionSample}
          onSaveAiConfig={handleSaveAiConfig}
          onDeletePatient={isBackendProfessional ? handleDeletePatient : null}
        />
      ) : (
        <section className="professional-detail" aria-label="Sin paciente seleccionado">
          <div className="panel">
            <p className="eyebrow">Ficha del usuario</p>
            <h2>Ningún paciente seleccionado</h2>
            <p>
              {patients.length === 0
                ? "Todavía no tenés pacientes cargados. Usá \"Agregar paciente\" para crear el primero."
                : "Seleccioná un paciente de la lista para ver su ficha, métricas y evolución."}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
