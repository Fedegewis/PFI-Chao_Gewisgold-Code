import { Brain, CheckCircle2, Copy, Send } from "lucide-react";
import { Link as LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MAX_AI_QUESTIONS, MIN_AI_QUESTIONS } from "../../constants/appConfig.js";

export function AiConfigPanel({ selectedPatient, onSave }) {
  const [instructions, setInstructions] = useState(selectedPatient.aiInstructions);
  const [maxQuestions, setMaxQuestions] = useState(selectedPatient.maxQuestions);
  const [configFeedback, setConfigFeedback] = useState("");
  const [linkFeedback, setLinkFeedback] = useState("");

  const aiInstructionsId = "ai-instructions";
  const aiMaxQuestionsId = "ai-max-questions";

  useEffect(() => {
    setInstructions(selectedPatient.aiInstructions);
    setMaxQuestions(selectedPatient.maxQuestions);
    setConfigFeedback("");
    setLinkFeedback("");
  }, [selectedPatient.id]);

  function handleSave() {
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
    onSave(trimmedInstructions, parsedMaxQuestions);
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
    <div className="panel">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Instrucciones para IA</p>
          <h2>{selectedPatient.name}</h2>
        </div>
        <Brain size={30} />
      </div>
      <label htmlFor={aiInstructionsId}>Como se mide y que tipo de preguntas debe hacer</label>
      <textarea
        id={aiInstructionsId}
        value={instructions}
        onChange={(e) => { setInstructions(e.target.value); setConfigFeedback(""); }}
      />
      <label htmlFor={aiMaxQuestionsId}>Cantidad maxima de preguntas</label>
      <input
        id={aiMaxQuestionsId}
        type="number"
        min={MIN_AI_QUESTIONS}
        max={MAX_AI_QUESTIONS}
        value={maxQuestions}
        onChange={(e) => { setMaxQuestions(e.target.value); setConfigFeedback(""); }}
      />
      <button className="primary" onClick={handleSave}>
        <CheckCircle2 size={20} /> Guardar criterio
      </button>
      {configFeedback && <p>{configFeedback}</p>}
      <div className="link-box">
        <LinkIcon size={22} />
        <div>
          <strong>Envio de link</strong>
          <p>{selectedPatient.link}</p>
          {linkFeedback && <small>{linkFeedback}</small>}
        </div>
        <button className="icon-action" title="Copiar link" type="button" onClick={copyPatientLink}>
          <Copy size={20} />
        </button>
        <button className="icon-action" title="Enviar link" type="button" onClick={sendPatientLink}>
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
