import {
  Activity,
  BarChart3,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Copy,
  RotateCcw,
  Search,
  Send,
  Timer,
  TrendingUp,
  UserPlus
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { MAX_AI_QUESTIONS, MAX_PATIENT_AGE, MIN_AI_QUESTIONS } from "../constants/appConfig.js";
import { activities } from "../data/activities.js";
import { createNewProfessionalPatient, slugifyPatientName } from "../services/patientService.js";
import { computeStats, getPatientSessions } from "../services/sessionService.js";
import { AiObservation } from "../components/professional/AiObservation.jsx";
import { EvolutionChart } from "../components/professional/EvolutionChart.jsx";
import { SessionTable } from "../components/professional/SessionTable.jsx";
import { MetricCard } from "../components/common/MetricCard.jsx";
import { cx } from "../lib/cx.js";

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
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("70");
  const [instructions, setInstructions] = useState(selectedPatient.aiInstructions);
  const [maxQuestions, setMaxQuestions] = useState(selectedPatient.maxQuestions);
  const searchInputRef = useRef(null);
  const [linkFeedback, setLinkFeedback] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [patientFormFeedback, setPatientFormFeedback] = useState("");
  const [configFeedback, setConfigFeedback] = useState("");
  const patientNameId = "patient-name";
  const patientAgeId = "patient-age";
  const aiInstructionsId = "ai-instructions";
  const aiMaxQuestionsId = "ai-max-questions";

  const professionalPatients = patients.filter((patient) => patient.professionalId === professionalId);
  const filteredPatients = professionalPatients.filter((patient) => patient.name.toLowerCase().includes(searchQuery.toLowerCase().trim()));
  const patientSessions = useMemo(
    () => getPatientSessions(sessions, selectedPatient.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [sessions, selectedPatient.id]
  );
  const stats = useMemo(() => computeStats(patientSessions), [patientSessions]);

  function selectPatient(patient) {
    setSelectedPatientId(patient.id);
    setInstructions(patient.aiInstructions);
    setMaxQuestions(patient.maxQuestions);
    setLinkFeedback("");
    setConfigFeedback("");
  }

  function createNewPatient() {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setPatientFormFeedback("Ingresa un nombre para crear el paciente.");
      return;
    }
    const parsedAge = Number(newAge);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > MAX_PATIENT_AGE) {
      setPatientFormFeedback(`La edad debe ser un numero entero entre 1 y ${MAX_PATIENT_AGE}.`);
      return;
    }
    const nextPatientId = slugifyPatientName(trimmedName) || `paciente-${patients.length + 1}`;
    if (patients.some((patient) => patient.id === nextPatientId)) {
      setPatientFormFeedback("Ya existe un paciente con un nombre muy parecido. Usa otro nombre.");
      return;
    }
    const nextPatient = createNewProfessionalPatient({
      patientId: nextPatientId,
      name: trimmedName,
      age: parsedAge,
      professionalId
    });
    setPatients((current) => [...current, nextPatient]);
    setSelectedPatientId(nextPatient.id);
    setInstructions(nextPatient.aiInstructions);
    setMaxQuestions(nextPatient.maxQuestions);
    setNewName("");
    setNewAge("70");
    setPatientFormFeedback("Paciente creado correctamente.");
  }

  function saveAiConfig() {
    const trimmedInstructions = instructions.trim();
    const parsedMaxQuestions = Number(maxQuestions);
    if (!trimmedInstructions) {
      setConfigFeedback("Describe al menos una indicacion para la IA.");
      return;
    }
    if (!Number.isInteger(parsedMaxQuestions) || parsedMaxQuestions < MIN_AI_QUESTIONS || parsedMaxQuestions > MAX_AI_QUESTIONS) {
      setConfigFeedback(`La cantidad maxima debe estar entre ${MIN_AI_QUESTIONS} y ${MAX_AI_QUESTIONS} preguntas.`);
      return;
    }
    updatePatient(selectedPatient.id, { aiInstructions: trimmedInstructions, maxQuestions: parsedMaxQuestions });
    setInstructions(trimmedInstructions);
    setMaxQuestions(parsedMaxQuestions);
    setConfigFeedback("Criterio guardado.");
  }

  async function copyPatientLink() {
    const link = selectedPatient.link;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const helper = document.createElement("textarea");
        helper.value = link;
        helper.setAttribute("readonly", "");
        helper.style.position = "absolute";
        helper.style.left = "-9999px";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(helper);
        if (!copied) throw new Error("copy failed");
      }
      setLinkFeedback("Link copiado.");
    } catch {
      setLinkFeedback("No se pudo copiar el link en este navegador.");
    }
  }

  function sendPatientLink() {
    const subject = encodeURIComponent(`Acceso a MenteActiva Jardin para ${selectedPatient.name}`);
    const body = encodeURIComponent(`Hola, te comparto tu acceso demo: ${selectedPatient.link}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setLinkFeedback("Se preparo un correo con el link.");
  }

  return (
    <div className="professional-layout">
      <section className="panel professional-patients">
        <div className="section-head compact"><div><p className="eyebrow">Panel de pacientes</p><h2>Seguimiento</h2></div><button className="icon-action" type="button" title="Buscar paciente" aria-label="Buscar paciente" onClick={() => searchInputRef.current?.focus()}><Search size={22} /></button></div>
        <input ref={searchInputRef} type="search" placeholder="Buscar por nombre..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Buscar paciente por nombre" style={{ marginBottom: "0.5rem" }} />
        <div className="patient-list">{filteredPatients.length > 0 ? filteredPatients.map((patient) => <button key={patient.id} className={cx("patient-row", patient.id === selectedPatient.id && "selected-patient")} onClick={() => selectPatient(patient)}><div className="avatar">{patient.name[0]}</div><div><strong>{patient.name}</strong><span>{patient.age} años</span><small>{patient.status}</small></div><ChevronRight size={22} /></button>) : <div className="empty-chart">No hay pacientes que coincidan con "{searchQuery}".</div>}</div>
        <div className="create-box"><p className="eyebrow">Creacion del paciente</p><label htmlFor={patientNameId}>Nombre del paciente</label><input id={patientNameId} value={newName} onChange={(event) => { setNewName(event.target.value); setPatientFormFeedback(""); }} placeholder="Nombre del paciente" /><label htmlFor={patientAgeId}>Edad</label><input id={patientAgeId} value={newAge} onChange={(event) => { setNewAge(event.target.value); setPatientFormFeedback(""); }} placeholder="Edad" /><button className="primary" onClick={createNewPatient}><UserPlus size={20} /> Crear paciente</button>{patientFormFeedback && <p>{patientFormFeedback}</p>}<button className="secondary-action reset-demo" onClick={resetDemo}><RotateCcw size={18} /> Reiniciar datos demo</button></div>
      </section>
      <section className="professional-stack">
        <div className="metric-grid">
          <MetricCard icon={CheckCircle2} label="Aciertos" value={stats.count ? `${stats.avgAccuracy}%` : `${selectedPatient.score}%`} detail={selectedPatient.trend} />
          <MetricCard icon={Timer} label="Tiempo medio" value={stats.count ? `${stats.avgLatencySec} s` : selectedPatient.rt} detail="respuesta" />
          <MetricCard icon={Activity} label="Riesgo" value={selectedPatient.risk} detail="preventivo" />
          <MetricCard icon={CalendarDays} label="Sesiones" value={`${stats.count}`} detail={`${stats.weekCount} esta semana`} />
        </div>
        <div className="panel">
          <div className="section-head compact"><div><p className="eyebrow">Evolucion del rendimiento</p><h2>Precision por sesion</h2></div><TrendingUp size={30} /></div>
          <EvolutionChart sessions={patientSessions} />
          <SessionTable sessions={patientSessions} />
        </div>
        <AiObservation patient={selectedPatient} sessions={sessions} />
        <div className="panel">
          <div className="section-head compact"><div><p className="eyebrow">Instrucciones para IA</p><h2>{selectedPatient.name}</h2></div><Brain size={30} /></div>
          <label htmlFor={aiInstructionsId}>Como se mide y que tipo de preguntas debe hacer</label>
          <textarea id={aiInstructionsId} value={instructions} onChange={(event) => { setInstructions(event.target.value); setConfigFeedback(""); }} />
          <label htmlFor={aiMaxQuestionsId}>Cantidad maxima de preguntas</label>
          <input id={aiMaxQuestionsId} type="number" min={MIN_AI_QUESTIONS} max={MAX_AI_QUESTIONS} value={maxQuestions} onChange={(event) => { setMaxQuestions(event.target.value); setConfigFeedback(""); }} />
          <button className="primary" onClick={saveAiConfig}><CheckCircle2 size={20} /> Guardar criterio</button>
          {configFeedback && <p>{configFeedback}</p>}
          <div className="link-box"><LinkIcon size={22} /><div><strong>Envio de link</strong><p>{selectedPatient.link}</p>{linkFeedback && <small>{linkFeedback}</small>}</div><button className="icon-action" title="Copiar link" type="button" onClick={copyPatientLink}><Copy size={20} /></button><button className="icon-action" title="Enviar link" type="button" onClick={sendPatientLink}><Send size={20} /></button></div>
        </div>
        <div className="panel">
          <div className="section-head compact"><div><p className="eyebrow">Dentro de cada paciente</p><h2>Preguntas que se hacen</h2></div><BarChart3 size={30} /></div>
          <div className="question-bank">{activities.flatMap((activity) => activity.questions.map((question, index) => <article key={`${activity.id}-${index}`}><strong>{activity.title}</strong><p>{question.prompt}</p><small>{question.clinician}</small></article>))}</div>
        </div>
      </section>
    </div>
  );
}
