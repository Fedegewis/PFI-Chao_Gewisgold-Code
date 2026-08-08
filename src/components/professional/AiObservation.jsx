import { Loader2, NotebookPen, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { generateObservation } from "../../ai.js";
import { cx } from "../../lib/cx.js";

const SECTION_LABELS = {
  resumen: "Resumen",
  tendencia: "Tendencia",
  latencia: "Tiempos",
  recomendacion: "Recomendación"
};

export function AiObservation({ patient, sessions }) {
  const [state, setState] = useState({ loading: false, text: "", sections: null, source: null });

  async function run() {
    setState({ loading: true, text: "", sections: null, source: null });
    const result = await generateObservation(patient, sessions);
    setState({ loading: false, text: result.text, sections: result.sections ?? null, source: result.source });
  }

  const buttonLabel = state.loading
    ? <><Loader2 size={20} className="spin" aria-hidden="true" /> Generando</>
    : state.text
      ? <><RefreshCw size={20} aria-hidden="true" /> Regenerar observación</>
      : <><Sparkles size={20} aria-hidden="true" /> Generar observación</>;

  return (
    <div className="panel ai-observation">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Observaciones por IA</p>
          <h2>Síntesis clínica</h2>
        </div>
        <NotebookPen size={26} aria-hidden="true" />
      </div>
      <p className="ai-hint">Lectura de patrones a partir de las métricas reales del paciente. Usa Ollama local si está disponible; si no, una síntesis heurística.</p>
      <button className="primary ai-observation-button" type="button" onClick={run} disabled={state.loading} aria-busy={state.loading}>
        {buttonLabel}
      </button>
      {state.text && (
        <div className="ai-output" role="status" aria-live="polite">
          <span className={cx("ai-badge", state.source === "ollama" ? "ai-badge-ollama" : "ai-badge-local")}>
            {state.source === "ollama" ? "Generado con Ollama" : "Síntesis local"}
          </span>
          {state.sections
            ? (
              <div className="synthesis-blocks">
                {Object.entries(state.sections).map(([key, value]) => (
                  <section key={key} className="synthesis-block">
                    <p className="synthesis-label">{SECTION_LABELS[key] ?? key}</p>
                    <p className="synthesis-text">{value}</p>
                  </section>
                ))}
              </div>
            )
            : <p className="synthesis-text">{state.text}</p>}
        </div>
      )}
    </div>
  );
}
