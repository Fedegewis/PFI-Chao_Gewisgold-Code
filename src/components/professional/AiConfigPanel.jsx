import { AlertTriangle, Brain, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { COGNITIVE_DOMAINS, MAX_AI_QUESTIONS, MIN_AI_QUESTIONS } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";

function resolveActiveDomains(stored) {
  if (!Array.isArray(stored) || stored.length === 0) return [...COGNITIVE_DOMAINS];
  const valid = stored.filter((d) => COGNITIVE_DOMAINS.includes(d));
  if (valid.length === 0 || valid.length < stored.length) return [...COGNITIVE_DOMAINS];
  return valid;
}

export function AiConfigPanel({ selectedPatient, onSave }) {
  const [instructions, setInstructions] = useState(selectedPatient.aiInstructions);
  const [maxQuestions, setMaxQuestions] = useState(selectedPatient.maxQuestions);
  const [activeDomains, setActiveDomains] = useState(() => resolveActiveDomains(selectedPatient.activeDomains));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const aiInstructionsId = "ai-instructions";
  const aiMaxQuestionsId = "ai-max-questions";

  useEffect(() => {
    setInstructions(selectedPatient.aiInstructions);
    setMaxQuestions(selectedPatient.maxQuestions);
    setActiveDomains(resolveActiveDomains(selectedPatient.activeDomains));
    setSaved(false);
    setError("");
  }, [selectedPatient.id]);

  function markDirty() {
    setSaved(false);
    setError("");
  }

  function toggleDomain(domain) {
    setActiveDomains((prev) => prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]);
    markDirty();
  }

  function handleSave() {
    const trimmedInstructions = instructions.trim();
    const parsedMaxQuestions = Number(maxQuestions);
    if (!trimmedInstructions) {
      setError("Describí al menos una indicación.");
      return;
    }
    if (!Number.isInteger(parsedMaxQuestions) || parsedMaxQuestions < MIN_AI_QUESTIONS || parsedMaxQuestions > MAX_AI_QUESTIONS) {
      setError(`La cantidad máxima debe estar entre ${MIN_AI_QUESTIONS} y ${MAX_AI_QUESTIONS} preguntas.`);
      return;
    }
    if (activeDomains.length === 0) {
      setError("Seleccioná al menos un dominio cognitivo.");
      return;
    }
    onSave(trimmedInstructions, parsedMaxQuestions, activeDomains);
    setInstructions(trimmedInstructions);
    setMaxQuestions(parsedMaxQuestions);
    setSaved(true);
    setError("");
  }

  return (
    <div className="panel ai-config-panel">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Instrucciones</p>
          <h3>{selectedPatient.name}</h3>
        </div>
        <Brain size={30} aria-hidden="true" />
      </div>
      <label htmlFor={aiInstructionsId}>Cómo se mide y qué tipo de preguntas debe hacer</label>
      <textarea
        id={aiInstructionsId}
        value={instructions}
        onChange={(e) => { setInstructions(e.target.value); markDirty(); }}
      />
      <label htmlFor={aiMaxQuestionsId}>Cantidad máxima de preguntas</label>
      <input
        id={aiMaxQuestionsId}
        type="number"
        min={MIN_AI_QUESTIONS}
        max={MAX_AI_QUESTIONS}
        value={maxQuestions}
        onChange={(e) => { setMaxQuestions(e.target.value); markDirty(); }}
      />
      <fieldset className="domain-fieldset">
        <legend>Dominios cognitivos activos</legend>
        <div className="domain-chips">
          {COGNITIVE_DOMAINS.map((domain) => (
            <button
              key={domain}
              type="button"
              className={cx("domain-chip", activeDomains.includes(domain) && "domain-chip--active")}
              onClick={() => toggleDomain(domain)}
              aria-pressed={activeDomains.includes(domain)}
            >
              {domain}
            </button>
          ))}
        </div>
      </fieldset>
      <button className={cx("primary", saved && "primary--saved")} type="button" onClick={handleSave}>
        <CheckCircle2 size={20} aria-hidden="true" /> {saved ? "Guardado" : "Guardar criterio"}
      </button>
      {error && (
        <p className="form-feedback form-feedback-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
