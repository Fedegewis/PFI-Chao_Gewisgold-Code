import { Bot, Loader2, NotebookPen, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { generateObservation } from "../../ai.js";
import { cx } from "../../lib/cx.js";

const SECTION_LABELS = {
  resumen: "Resumen",
  tendencia: "Tendencia",
  latencia: "Tiempos",
  recomendacion: "Recomendación"
};

const INITIAL_STATE = { loading: false, text: "", sections: null, source: null };

export function AiObservation({ patient, sessions }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    setState(INITIAL_STATE);
    setShowModal(false);
  }, [patient.id]);

  async function run() {
    setState({ loading: true, text: "", sections: null, source: null });
    try {
      const result = await generateObservation(patient, sessions);
      setState({ loading: false, text: result.text, sections: result.sections ?? null, source: result.source });
      setShowModal(true);
    } catch {
      setState({ loading: false, text: "No se pudo generar la observación. Intentá nuevamente.", sections: null, source: null });
    }
  }

  const buttonLabel = state.loading
    ? <><Loader2 size={20} className="spin" aria-hidden="true" /> Generando</>
    : state.text
      ? <><RefreshCw size={20} aria-hidden="true" /> Regenerar observación</>
      : <><Bot size={20} aria-hidden="true" /> Generar observación</>;

  return (
    <div className="panel ai-observation">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Observaciones</p>
          <h3>Síntesis clínica</h3>
        </div>
        <NotebookPen size={26} aria-hidden="true" />
      </div>
      <p className="ai-hint">Lectura de patrones a partir de las métricas reales del paciente.</p>
      <button className="primary ai-observation-button" type="button" onClick={run} disabled={state.loading} aria-busy={state.loading}>
        {buttonLabel}
      </button>
      {state.text && !showModal && (
        <button type="button" className="ai-view-button" onClick={() => setShowModal(true)}>
          Ver observación generada
        </button>
      )}
      {showModal && state.text && (
        <div className="ai-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="ai-modal" role="dialog" aria-label="Observación clínica" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <div>
                <p className="eyebrow">Observaciones</p>
                <h3>Síntesis clínica — {patient.name}</h3>
              </div>
              <button type="button" className="ai-modal-close" onClick={() => setShowModal(false)} aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>
            <div className="ai-modal-body">
              <span className={cx("ai-badge", "ai-badge-local")}>
                Síntesis local
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
          </div>
        </div>
      )}
    </div>
  );
}
