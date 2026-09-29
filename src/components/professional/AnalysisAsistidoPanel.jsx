import { AlertTriangle, Bot, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { generateAnalysis, getAnalysis } from "../../services/analysisApi.js";
import { formatSectionLabel, groupEvidenceForRender } from "../../lib/analysisFormat.js";

const LOAD_HINT = "El análisis puede demorar algunos segundos mientras el asistente procesa la sesión.";
// Intervalo de polling para status="generating" (largo, la inferencia dura decenas de segundos).
const POLL_INTERVAL_MS = 4000;
// Intervalo más corto para reintentar cuando el backend aún devuelve
// no_analysis: hay una ventana breve entre /complete y la creación de la
// fila 'generating' por el fire-and-forget.
const NO_ANALYSIS_RETRY_MS = 300;
const NO_ANALYSIS_RETRIES = 2;

function errorMessage(err) {
  const code = err?.data?.status;
  if (code === "ai_unavailable") {
    return "El asistente de análisis no está disponible en este momento. Intentá nuevamente en unos minutos.";
  }
  if (code === "ai_invalid_output") {
    return "El asistente devolvió una respuesta que no cumple el contrato esperado. Podés intentar regenerar el análisis.";
  }
  return err?.message || "No se pudo procesar el análisis. Reintentá.";
}

function AnalysisContent({ content }) {
  if (!content) return null;
  const summary = content.summary || "";
  const observations = Array.isArray(content.observations_by_section) ? content.observations_by_section : [];
  const aspects = Array.isArray(content.aspects_to_review) ? content.aspects_to_review : [];
  const evidenceGroups = groupEvidenceForRender(content.evidence);

  return (
    <div className="analysis-body">
      {summary && (
        <div className="analysis-block">
          <p className="eyebrow">Resumen</p>
          <p className="analysis-summary">{summary}</p>
        </div>
      )}

      {observations.length > 0 && (
        <div className="analysis-block">
          <p className="eyebrow">Observaciones por sección</p>
          <ul className="analysis-observations">
            {observations.map((o) => (
              <li key={o.section_slug}>
                <p className="analysis-section-label">{formatSectionLabel(o.section_slug)}</p>
                <p className="analysis-observation-text">{o.observation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aspects.length > 0 && (
        <div className="analysis-block">
          <p className="eyebrow">Aspectos a revisar</p>
          <ul className="analysis-aspects">
            {aspects.map((a, i) => (
              <li key={`${a}-${i}`}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {evidenceGroups.length > 0 && (
        <div className="analysis-block">
          <p className="eyebrow">Evidencia utilizada</p>
          <div className="analysis-evidence-groups">
            {evidenceGroups.map((g) => (
              <div key={`${g.scope}-${g.sectionSlug || "global"}-${g.group}`} className="analysis-evidence-group">
                <p className="analysis-section-label">{g.group}</p>
                <dl className="analysis-evidence-list">
                  {g.items.map((it, i) => (
                    <div key={`${it.metricLabel}-${i}`} className="analysis-evidence-item">
                      <dt>{it.metricLabel}</dt>
                      <dd>{it.valueLabel}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalysisAsistidoPanel({ session }) {
  const sessionId = session?.id ?? null;
  const isCompleted = session?.status === "completed";

  const [loadingInitial, setLoadingInitial] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  // status semántico devuelto por el backend en GET (7J.2):
  //   "ok" | "generating" | "last_failed" | "no_analysis" | null
  const [status, setStatus] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const pollTimerRef = useRef(null);
  const cancelledRef = useRef(false);

  function clearPoll() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  useEffect(() => {
    // Reset y setup on session change.
    cancelledRef.current = false;
    clearPoll();
    setAnalysis(null);
    setError("");
    setStatus(null);
    setRegenerating(false);

    if (!sessionId || !isCompleted) {
      setLoadingInitial(false);
      return () => {
        cancelledRef.current = true;
        clearPoll();
      };
    }

    let noAnalysisRetries = 0;
    let cancelled = false;
    setLoadingInitial(true);

    async function runOnce() {
      try {
        const data = await getAnalysis(sessionId);
        if (cancelled) return;
        const st = data?.status || (data?.analysis ? "ok" : null);
        if (st === "ok") {
          setAnalysis(data.analysis);
          setStatus("ok");
          setRegenerating(Boolean(data?.regenerating));
          setError("");
          // Si hay una regeneración en curso, seguir consultando para
          // reflejar el nuevo resultado cuando aparezca.
          if (data?.regenerating) schedulePoll();
          else clearPoll();
        } else if (st === "generating") {
          setAnalysis(null);
          setStatus("generating");
          setRegenerating(false);
          setError("");
          schedulePoll();
        } else if (st === "last_failed") {
          setAnalysis(null);
          setStatus("last_failed");
          setRegenerating(false);
          setError("");
          clearPoll();
        } else {
          // Respuesta sin status conocido: no debería pasar en 7J.2, pero
          // no rompemos la UI.
          setStatus(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404 && err?.data?.status === "no_analysis") {
          // Ventana corta entre /complete y creación de la fila generating.
          if (noAnalysisRetries < NO_ANALYSIS_RETRIES) {
            noAnalysisRetries += 1;
            schedulePoll(NO_ANALYSIS_RETRY_MS);
            return;
          }
          setStatus("no_analysis");
          setError("");
          clearPoll();
        } else {
          setError(errorMessage(err));
          setStatus(null);
          clearPoll();
        }
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    }

    function schedulePoll(intervalMs = POLL_INTERVAL_MS) {
      clearPoll();
      pollTimerRef.current = setTimeout(() => {
        pollTimerRef.current = null;
        if (!cancelled) runOnce();
      }, intervalMs);
    }

    runOnce();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      clearPoll();
    };
  }, [sessionId, isCompleted]);

  async function runGenerate({ force }) {
    if (!sessionId || !isCompleted || generating) return;
    setGenerating(true);
    setError("");
    try {
      const data = await generateAnalysis(sessionId, { force });
      // La respuesta POST siempre trae analysis directo si status ok.
      if (data?.analysis) {
        setAnalysis(data.analysis);
        setStatus("ok");
        setRegenerating(false);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Análisis asistido</p>
          <h3>Síntesis de la sesión</h3>
        </div>
        <Sparkles size={22} aria-hidden="true" />
      </div>

      {!sessionId && (
        <p className="ai-hint">Seleccioná una sesión del historial para ver o generar un análisis.</p>
      )}

      {sessionId && !isCompleted && (
        <p className="ai-hint">El análisis asistido solo está disponible para sesiones completadas.</p>
      )}

      {sessionId && isCompleted && loadingInitial && (
        <p className="ai-hint" role="status" aria-live="polite">
          <Loader2 size={16} aria-hidden="true" /> Cargando análisis…
        </p>
      )}

      {sessionId && isCompleted && !loadingInitial && error && (
        <div className="error-box" role="alert">
          <AlertTriangle size={20} aria-hidden="true" /> {error}
        </div>
      )}

      {sessionId && isCompleted && !loadingInitial && !error && status === "generating" && (
        <>
          <p className="ai-hint" role="status" aria-live="polite">
            <Loader2 size={16} aria-hidden="true" /> Generando análisis de esta sesión…
          </p>
          <p className="ai-hint">{LOAD_HINT}</p>
        </>
      )}

      {sessionId && isCompleted && !loadingInitial && !error && status === "no_analysis" && (
        <>
          <p className="ai-hint">
            Todavía no hay análisis generado para esta sesión. Podés crearlo manualmente ahora.
          </p>
          <div className="activity-actions single">
            <button
              type="button"
              className="primary"
              onClick={() => runGenerate({ force: false })}
              disabled={generating}
            >
              {generating ? (<><Loader2 size={16} aria-hidden="true" /> Generando…</>) : (<><Bot size={16} aria-hidden="true" /> Generar análisis</>)}
            </button>
          </div>
          {generating && (
            <p className="ai-hint" role="status" aria-live="polite">{LOAD_HINT}</p>
          )}
        </>
      )}

      {sessionId && isCompleted && !loadingInitial && !error && status === "last_failed" && (
        <>
          <p className="ai-hint">
            No se pudo generar el análisis automáticamente. Podés reintentarlo.
          </p>
          <div className="activity-actions single">
            <button
              type="button"
              className="primary"
              onClick={() => runGenerate({ force: false })}
              disabled={generating}
            >
              {generating ? (<><Loader2 size={16} aria-hidden="true" /> Reintentando…</>) : (<><RefreshCw size={16} aria-hidden="true" /> Reintentar análisis</>)}
            </button>
          </div>
          {generating && (
            <p className="ai-hint" role="status" aria-live="polite">{LOAD_HINT}</p>
          )}
        </>
      )}

      {sessionId && isCompleted && !loadingInitial && analysis && status === "ok" && (
        <>
          {regenerating && (
            <p className="ai-hint" role="status" aria-live="polite">
              <Loader2 size={16} aria-hidden="true" /> Regenerando análisis en segundo plano…
            </p>
          )}
          <AnalysisContent content={analysis.content} />
          <div className="activity-actions single">
            <button
              type="button"
              onClick={() => runGenerate({ force: true })}
              disabled={generating}
            >
              {generating ? (<><Loader2 size={16} aria-hidden="true" /> Regenerando…</>) : (<><RefreshCw size={16} aria-hidden="true" /> Regenerar análisis</>)}
            </button>
          </div>
          {generating && (
            <p className="ai-hint" role="status" aria-live="polite">{LOAD_HINT}</p>
          )}
        </>
      )}
    </div>
  );
}
