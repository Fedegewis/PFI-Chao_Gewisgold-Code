import { ChevronRight, RotateCcw, Search, UserPlus } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_PATIENT_AGE } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";
import { slugifyPatientName } from "../../services/patientService.js";

export function PatientSidebar({ patients, professionalId, selectedPatient, onSelectPatient, onCreatePatient, onResetDemo }) {
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("70");
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const searchInputRef = useRef(null);

  const patientNameId = "patient-name";
  const patientAgeId = "patient-age";

  const professionalPatients = patients.filter((p) => p.professionalId === professionalId);
  const filteredPatients = professionalPatients.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  function handleCreate() {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setFeedback("Ingresa un nombre para crear el paciente.");
      return;
    }
    const parsedAge = Number(newAge);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > MAX_PATIENT_AGE) {
      setFeedback(`La edad debe ser un numero entero entre 1 y ${MAX_PATIENT_AGE}.`);
      return;
    }
    const nextPatientId = slugifyPatientName(trimmedName) || `paciente-${patients.length + 1}`;
    if (patients.some((p) => p.id === nextPatientId)) {
      setFeedback("Ya existe un paciente con un nombre muy parecido. Usa otro nombre.");
      return;
    }
    onCreatePatient(trimmedName, parsedAge);
    setNewName("");
    setNewAge("70");
    setFeedback("Paciente creado correctamente.");
  }

  return (
    <section className="panel professional-patients">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Panel de pacientes</p>
          <h2>Seguimiento</h2>
        </div>
        <button
          className="icon-action"
          type="button"
          title="Buscar paciente"
          aria-label="Buscar paciente"
          onClick={() => searchInputRef.current?.focus()}
        >
          <Search size={22} />
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
      <div className="patient-list">
        {filteredPatients.length > 0 ? (
          filteredPatients.map((patient) => (
            <button
              key={patient.id}
              className={cx("patient-row", patient.id === selectedPatient.id && "selected-patient")}
              onClick={() => onSelectPatient(patient)}
            >
              <div className="avatar">{patient.name[0]}</div>
              <div>
                <strong>{patient.name}</strong>
                <span>{patient.age} años</span>
                <small>{patient.status}</small>
              </div>
              <ChevronRight size={22} />
            </button>
          ))
        ) : (
          <div className="empty-chart">No hay pacientes que coincidan con &quot;{searchQuery}&quot;.</div>
        )}
      </div>
      <div className="create-box">
        <p className="eyebrow">Creacion del paciente</p>
        <label htmlFor={patientNameId}>Nombre del paciente</label>
        <input
          id={patientNameId}
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setFeedback(""); }}
          placeholder="Nombre del paciente"
        />
        <label htmlFor={patientAgeId}>Edad</label>
        <input
          id={patientAgeId}
          value={newAge}
          onChange={(e) => { setNewAge(e.target.value); setFeedback(""); }}
          placeholder="Edad"
        />
        <button className="primary" onClick={handleCreate}>
          <UserPlus size={20} /> Crear paciente
        </button>
        {feedback && <p>{feedback}</p>}
        <button className="secondary-action reset-demo" onClick={onResetDemo}>
          <RotateCcw size={18} /> Reiniciar datos demo
        </button>
      </div>
    </section>
  );
}
