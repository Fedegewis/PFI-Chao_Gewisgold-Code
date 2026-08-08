import { Loader2, NotebookPen, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { generateObservation } from "../../ai.js";
import { cx } from "../../lib/cx.js";

export function AiObservation({ patient, sessions }) {
  const [state, setState] = useState({ loading: false, text: "", source: null });

  async function run() {
    setState({ loading: true, text: "", source: null });
    const result = await generateObservation(patient, sessions);
    setState({ loading: false, text: result.text, source: result.source });
  }

  return (
    <div className="panel ai-observation">
      <div className="section-head compact"><div><p className="eyebrow">Observaciones por IA</p><h2>Sintesis clinica</h2></div><NotebookPen size={30} aria-hidden="true" /></div>
      <p className="ai-hint">Genera una lectura de patrones a partir de las metricas reales del paciente. Usa Ollama local si esta disponible; si no, una sintesis heuristica.</p>
      <button className="primary" type="button" onClick={run} disabled={state.loading} aria-busy={state.loading}>
        {state.loading
          ? <><Loader2 size={20} className="spin" aria-hidden="true" /> Generando</>
          : state.text
            ? <><RefreshCw size={20} aria-hidden="true" /> Regenerar observacion</>
            : <><Sparkles size={20} aria-hidden="true" /> Generar observacion</>}
      </button>
      {state.text && (
        <div className="ai-output" role="status" aria-live="polite">
          <span className={cx("ai-badge", state.source === "ollama" ? "ai-badge-ollama" : "ai-badge-local")}>{state.source === "ollama" ? "Generado con Ollama" : "Sintesis local"}</span>
          <p>{state.text}</p>
        </div>
      )}
    </div>
  );
}
