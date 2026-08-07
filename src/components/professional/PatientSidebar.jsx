import { AlertTriangle, CheckCircle2, ChevronRight, RotateCcw, Search, UserPlus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MAX_PATIENT_AGE } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";
import { slugifyPatientName } from "../../services/patientService.js";

export function PatientSidebar({ patients, professionalId, selectedPatient, onSelectPatient, onCreatePatient, onResetDemo }) {
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("70");
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState({ text: "", type: "" });
  const searchInputRef = useRef(null);

  const patientNameId = "patient-name";
  const patientAgeId = "patient-age";

  const professionalPatients = useMemo(
    () => patients.filter((p) => p.professionalId === professionalId),
    [patients, professionalId]
  );
  const filteredPatients = useMemo(
    () => professionalPatients.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
    ),
    [professionalPatients, searchQuery]
  );

  function setError(text) { setFeedback({ text, type: "error" }); }
  function setSuccess(text) { setFeedback({ text, type: "success" }); }
  function clearFeedback() { setFeedback({ text: "", type: "" }); }

  function handleCreate() {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setError("Ingresa un nombre para crear el paciente.");
      return;
    }
    const parsedAge = Number(newAge);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > MAX_PATIENT_AGE) {
      setError(`La edad debe ser un numero entero entre 1 y ${MAX_PATIENT_AGE}.`);
      return;
    }
    const nextPatientId = slugifyPatientName(trimmedName) || `paciente-${patients.length + 1}`;
    if (patients.some((p) => p.id === nextPatientId)) {
      setError("Ya existe un paciente con un nombre muy parecido. Usa otro nombre.");
      return;
    }
    onCreatePatient(trimmedName, parsedAge);
    setNewName("");
    setNewAge("70");
    setSuccess("Paciente creado correctamente.");
  }

  function renderPatientList() {
    if (filteredPatients.length > 0) {
      return filteredPatients.map((patient) => (
        <button
          key={patient.id}
          type="button"
          className={cx("patient-row", patient.id === selectedPatient.id && "selected-patient")}
          aria-current={patient.id === selectedPatient.id ? "true" : undefined}
          onClick={() => onSelectPatient(patient)}
        >
          <div className="avatar" aria-hidden="true">{patient.name[0]}</div>
          <div>
            <strong>{patient.name}</strong>
            <span>{patient.age} años</span>
            <small>{patient.status}</small>
          </div>
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      ));
    }
    if (searchQuery) {
      return <div className="empty-chart">No hay pacientes que coincidan con &quot;{searchQuery}&quot;.</div>;
    }
    return <div className="empty-chart">Aun no hay pacientes asignados. Crea el primero con el formulario de abajo.</div>;
  }

  return (
    <section className="panel professional-patients" aria-label="Panel de pacientes">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Panel de pacientes</p>
          <h2>Seguimiento</h2>
        </div>
        <button
          className="icon-action"
          type="button"
          aria-label="Buscar paciente"
          onClick={() => searchInputRef.current?.focus()}
        >
          <Search size={22} aria-hidden="true" />
        </button>
      </div>
      <input
        ref={searchInputRef}
        type="search"
        placeholder="Buscar por nombre..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label="Buscar paciente por nombre"
        style={{ marginBottom: "0.5rem" }}
      />
      <div className="patient-list" role="list" aria-label="Lista de pacientes">
        {renderPatientList()}
      </div>
      <div className="create-box">
        <p className="eyebrow">Creacion del paciente</p>
        <label htmlFor={patientNameId}>Nombre del paciente</label>
        <input
          id={patientNameId}
          value={newName}
          onChange={(e) => { setNewName(e.target.value); clearFeedback(); }}
          placeholder="Nombre del paciente"
        />
        <label htmlFor={patientAgeId}>Edad</label>
        <input
          id={patientAgeId}
          type="number"
          min="1"
          max={MAX_PATIENT_AGE}
          value={newAge}
          onChange={(e) => { setNewAge(e.target.value); clearFeedback(); }}
          placeholder="Edad"
        />
        <button className="primary" type="button" onClick={handleCreate}>
          <UserPlus size={20} aria-hidden="true" /> Crear paciente
        </button>
        {feedback.text && (
          <p
            className={cx("form-feedback", feedback.type === "success" ? "form-feedback-success" : "form-feedback-error")}
            role="alert"
          >
            {feedback.type === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
            {" "}{feedback.text}
          </p>
        )}
        <button className="secondary-action reset-demo" type="button" onClick={onResetDemo}>
          <RotateCcw size={18} aria-hidden="true" /> Reiniciar datos demo
        </button>
      </div>
    </section>
  );
}
