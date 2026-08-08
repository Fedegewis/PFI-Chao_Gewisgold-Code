import { AlertTriangle, CheckCircle2, Plus, Search, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { MAX_PATIENT_AGE } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";
import { generatePatientId } from "../../services/patientService.js";
import { PatientCard } from "./PatientCard.jsx";

export function PatientGrid({
  patients,
  professionalId,
  selectedPatient,
  onSelectPatient,
  onCreatePatient
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [creating, setCreating] = useState(true);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("70");
  const [feedback, setFeedback] = useState({ text: "", type: "" });

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

  const activeCount = professionalPatients.filter((p) => (p.completed?.length ?? 0) > 0 || p.answers > 0).length;

  function resetForm() {
    setNewName("");
    setNewAge("70");
    setFeedback({ text: "", type: "" });
  }

  function handleCreate() {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setFeedback({ text: "Ingresá un nombre para crear el paciente.", type: "error" });
      return;
    }
    const parsedAge = Number(newAge);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > MAX_PATIENT_AGE) {
      setFeedback({ text: `La edad debe ser un número entero entre 1 y ${MAX_PATIENT_AGE}.`, type: "error" });
      return;
    }
    const nextPatientId = generatePatientId(trimmedName, patients.length + 1);
    if (patients.some((p) => p.id === nextPatientId)) {
      setFeedback({ text: "Ya existe un paciente con un nombre muy parecido. Usá otro nombre.", type: "error" });
      return;
    }
    onCreatePatient(trimmedName, parsedAge);
    resetForm();
    setFeedback({ text: "Paciente creado correctamente.", type: "success" });
  }

  return (
    <section className="panel patient-grid-panel" aria-label="Panel de pacientes">
      <div className="patient-grid-head">
        <div>
          <p className="eyebrow">Panel de pacientes</p>
          <h2>Seguimiento</h2>
          <small className="patient-grid-count">
            {professionalPatients.length} usuarios · {activeCount} con actividad
          </small>
        </div>
        <div className="patient-grid-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar por nombre..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar paciente por nombre"
          />
        </div>
      </div>

      <div className="patient-grid" role="list" aria-label="Lista de pacientes">
        {filteredPatients.map((patient) => (
          <div role="listitem" key={patient.id}>
            <PatientCard
              patient={patient}
              selected={patient.id === selectedPatient.id}
              onSelect={onSelectPatient}
            />
          </div>
        ))}

        {!creating ? (
          <button
            type="button"
            className="patient-card new-patient-card"
            onClick={() => { setCreating(true); setFeedback({ text: "", type: "" }); }}
            aria-label="Abrir formulario para agregar paciente"
          >
            <div className="new-patient-icon" aria-hidden="true"><Plus size={26} /></div>
            <strong>Agregar paciente</strong>
            <small>Cargalo en segundos</small>
          </button>
        ) : (
          <div className="patient-card new-patient-card new-patient-card--open">
            <div className="new-patient-form-head">
              <strong>Nuevo paciente</strong>
              <button
                type="button"
                className="icon-action"
                aria-label="Cancelar creación"
                onClick={() => { setCreating(false); resetForm(); }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <label htmlFor="patient-name">Nombre del paciente</label>
            <input
              id="patient-name"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setFeedback({ text: "", type: "" }); }}
              placeholder="Nombre del paciente"
              autoFocus
            />
            <label htmlFor="patient-age">Edad</label>
            <input
              id="patient-age"
              type="number"
              min="1"
              max={MAX_PATIENT_AGE}
              value={newAge}
              onChange={(e) => { setNewAge(e.target.value); setFeedback({ text: "", type: "" }); }}
              placeholder="Edad"
            />
            <button className="primary" type="button" onClick={handleCreate}>
              <UserPlus size={18} aria-hidden="true" /> Crear paciente
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
          </div>
        )}
      </div>

      {filteredPatients.length === 0 && searchQuery && (
        <div className="empty-chart">No hay pacientes que coincidan con &quot;{searchQuery}&quot;.</div>
      )}
    </section>
  );
}
