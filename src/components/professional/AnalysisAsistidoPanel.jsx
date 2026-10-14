import { AlertTriangle, Bot, Database, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  generateAnalysis,
  getAnalysis,
  getAnalysisContext,
} from "../../services/analysisApi.js";
import {
  formatSectionLabel,
  groupEvidenceForRender,
  formatComparisonMetrics,
  collectActivityLabels,
  collectDomainLabels,
  buildGlobalMetricTiles,
  resolveReportedMood,
} from "../../lib/analysisFormat.js";

const LOAD_HINT = "El análisis puede demorar algunos segundos mientras el asistente procesa la sesión.";
const POLL_INTERVAL_MS = 4000;
const NO_ANALYSIS_RETRY_MS = 300;
const NO_ANALYSIS_RETRIES = 2;

const ERROR_CODE_DESCRIPTIONS = {
  OLLAMA_DISABLED: "El servicio de IA está deshabilitado en el servidor.",
  OLLAMA_OFFLINE: "Ollama no respondió. Verificá que el servicio esté corriendo.",
  OLLAMA_TIMEOUT: "Ollama excedió el tiempo máximo de inferencia.",
  OLLAMA_MODEL_NOT_FOUND: "El modelo configurado no está disponible en Ollama.",
  OLLAMA_HTTP_ERROR: "Ollama devolvió un error HTTP inesperado.",
  OLLAMA_EMPTY_RESPONSE: "Ollama devolvió una respuesta vacía.",
  OLLAMA_INVALID_JSON: "La respuesta del modelo no era JSON parseable.",
  ANALYSIS_INVALID_JSON: "La respuesta del modelo no era JSON válido.",
  ANALYSIS_SCHEMA_INVALID: "El modelo omitió o excedió un campo del contrato.",
  ANALYSIS_UNEXPECTED_FIELD: "El modelo agregó un campo que no corresponde.",
  ANALYSIS_SECTIONS_MISMATCH: "El modelo nombró secciones que no estaban en la sesión.",
  ANALYSIS_EVIDENCE_INVALID: "La evidencia enviada por el modelo no coincide con el contexto.",
  ANALYSIS_NUMERIC_METRIC_IN_TEXT: "El modelo incluyó cifras numéricas en el texto.",
  ANALYSIS_FORBIDDEN_CLINICAL_TERM: "El modelo usó términos clínicos o calificaciones prohibidas.",
  INVALID_JSON: "La respuesta del modelo no era JSON válido.",
  SCHEMA_INVALID: "El modelo omitió o excedió un campo del contrato.",
  UNEXPECTED_FIELD: "El modelo agregó un campo que no corresponde.",
  SECTIONS_MISMATCH: "El modelo nombró secciones que no estaban en la sesión.",
  EVIDENCE_INVALID: "La evidencia enviada por el modelo no coincide con el contexto.",
};

function describeFailure(code) {
  if (!code) return null;
  return ERROR_CODE_DESCRIPTIONS[code] || `Código: ${code}.`;
}

function errorMessage(err) {
  const code = err?.data?.status;
  if (code === "ai_unavailable") {
    return "El asistente de análisis no está disponible en este momento. Intentá nuevamente en unos minutos.";
  }
  if (code === "ai_invalid_output") {
    const detail = describeFailure(err?.data?.validation_code);
    return detail
      ? `El asistente devolvió una respuesta que no cumple el contrato esperado. Causa: ${detail} Podés intentar regenerar el análisis.`
      : "El asistente devolvió una respuesta que no cumple el contrato esperado. Podés intentar regenerar el análisis.";
  }
  return err?.message || "No se pudo procesar el análisis. Reintentá.";
}

function isModernComparisonContract(promptVersion) {
  if (typeof promptVersion !== "string" || promptVersion.length === 0) return false;
  const match = /^(\d+)\.(\d+)/.exec(promptVersion);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 2) return true;
  if (major === 2 && minor >= 4) return true;
  return false;
}

// -----------------------------------------------------------------
// Bloques determinísticos (v3.4). Fuente: `content` del análisis v3
// cuando existe, o la respuesta de /analysis-context cuando no hay
// análisis exitoso. La forma de los datos es la misma en ambos casos.
// -----------------------------------------------------------------

function DeterministicBlocks({ data }) {
  if (!data) return null;
  const activityNames = collectActivityLabels(data.activities);
  const domainNames = collectDomainLabels(data.activities);
  const metricTiles = buildGlobalMetricTiles(data.evidence);
  const mood = resolveReportedMood(data.evidence);
  const comparisonMetricsRows = formatComparisonMetrics(data.comparison_metrics || null);
  const observations = Array.isArray(data.observations) ? data.observations : [];
  const follow_up = Array.isArray(data.follow_up) ? data.follow_up : [];

  return (
    <>
      {/* 1. Resumen del entrenamiento */}
      <div className="analysis-block" data-testid="block-resumen">
        <p className="eyebrow">
          <Database size={14} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
          Resumen del entrenamiento
        </p>
        {activityNames.length > 0 && (
          <dl className="analysis-evidence-list">
            <div className="analysis-evidence-item">
              <dt>Actividades realizadas</dt>
              <dd>{activityNames.join(" · ")}</dd>
            </div>
            {domainNames.length > 0 && (
              <div className="analysis-evidence-item">
                <dt>Dominios cognitivos asociados a las preguntas</dt>
                <dd>{domainNames.join(" · ")}</dd>
              </div>
            )}
            <div className="analysis-evidence-item">
              <dt>Estado de ánimo informado</dt>
              <dd>{mood.label}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* 2. Indicadores de desempeño */}
      {metricTiles.length > 0 && (
        <div className="analysis-block" data-testid="block-indicadores">
          <p className="eyebrow">
            <Database size={14} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
            Indicadores de desempeño
          </p>
          <dl className="analysis-evidence-list">
            {metricTiles.map((t) => (
              <div key={t.metric} className="analysis-evidence-item">
                <dt>{t.label}</dt>
                <dd>{t.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 3. Comparación con sesiones anteriores */}
      {comparisonMetricsRows.length > 0 && (
        <div className="analysis-block" data-testid="block-comparacion">
          <p className="eyebrow">
            <Database size={14} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
            Comparación con sesiones anteriores
          </p>
          <dl className="analysis-evidence-list">
            {comparisonMetricsRows.map((row) => (
              <div key={row.metric} className="analysis-evidence-item">
                <dt>{row.label}</dt>
                <dd>{row.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 4. Observaciones para seguimiento (automáticas) */}
      {(observations.length > 0 || follow_up.length > 0) && (
        <div className="analysis-block" data-testid="block-observaciones">
          <p className="eyebrow">Observaciones para seguimiento (automáticas)</p>
          {observations.length > 0 && (
            <ul className="analysis-aspects">
              {observations.map((o, i) => (
                <li key={`obs-${i}`}>{o}</li>
              ))}
            </ul>
          )}
          {follow_up.length > 0 && (
            <>
              <p className="analysis-section-label" style={{ marginTop: 8 }}>
                Aspectos sugeridos para la próxima sesión
              </p>
              <ul className="analysis-aspects">
                {follow_up.map((f, i) => (
                  <li key={`fu-${i}`}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}

function AiSynthesisBlock({ content }) {
  const summary = typeof content?.summary === "string" ? content.summary : "";
  const aspects = Array.isArray(content?.aspects_to_review) ? content.aspects_to_review : [];
  if (!summary && aspects.length === 0) return null;
  return (
    <div className="analysis-block" data-testid="block-sintesis-ia">
      <p className="eyebrow">
        <Sparkles size={14} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
        Síntesis del asistente IA
      </p>
      {summary && <p className="analysis-summary">{summary}</p>}
      {aspects.length > 0 && (
        <>
          <p className="analysis-section-label" style={{ marginTop: 8 }}>Aspectos a revisar sugeridos por IA</p>
          <ul className="analysis-aspects">
            {aspects.map((a, i) => (
              <li key={`${a}-${i}`}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AnalysisContentV3({ content, deterministicFallback }) {
  // v3.4: los bloques determinísticos pueden venir del propio análisis
  // persistido (content.activities/evidence/observations/...) o, cuando
  // alguno falta (análisis v3.0-3.3 pre-v3.4), del fallback deterministic.
  const data = {
    activities: content.activities || deterministicFallback?.activities || [],
    evidence: content.evidence || deterministicFallback?.evidence || [],
    comparison_metrics:
      content.comparison_metrics || deterministicFallback?.comparison_metrics || null,
    observations:
      Array.isArray(content.observations) && content.observations.length > 0
        ? content.observations
        : deterministicFallback?.observations || [],
    follow_up:
      Array.isArray(content.follow_up) && content.follow_up.length > 0
        ? content.follow_up
        : deterministicFallback?.follow_up || [],
  };
  return (
    <div className="analysis-body">
      <DeterministicBlocks data={data} />
      <AiSynthesisBlock content={content} />
    </div>
  );
}

function AnalysisContentLegacy({ content, promptVersion }) {
  const summary = content.summary || "";
  const observations = Array.isArray(content.observations_by_section) ? content.observations_by_section : [];
  const aspects = Array.isArray(content.aspects_to_review) ? content.aspects_to_review : [];
  const comparisonMetrics = content.comparison_metrics || null;
  const comparisonMetricsRows = formatComparisonMetrics(comparisonMetrics);
  const isModern = isModernComparisonContract(promptVersion);
  const comparisonText =
    !comparisonMetrics && !isModern && typeof content.comparison === "string"
      ? content.comparison.trim()
      : "";
  const evidenceGroups = groupEvidenceForRender(content.evidence);

  return (
    <div className="analysis-body">
      {summary && (
        <div className="analysis-block">
          <p className="eyebrow">Síntesis de la sesión</p>
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
      {comparisonMetricsRows.length > 0 && (
        <div className="analysis-block">
          <p className="eyebrow">Comparación con la sesión anterior comparable</p>
          <dl className="analysis-evidence-list">
            {comparisonMetricsRows.map((row) => (
              <div key={row.metric} className="analysis-evidence-item">
                <dt>{row.label}</dt>
                <dd>{row.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {comparisonText && (
        <div className="analysis-block">
          <p className="eyebrow">Comparación con sesiones recientes</p>
          <p className="analysis-observation-text">{comparisonText}</p>
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
          <p className="eyebrow">Datos relevantes</p>
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

function AnalysisContent({ content, promptVersion, deterministicFallback }) {
  if (!content) return null;
  if (content.schema_version === "3") {
    return <AnalysisContentV3 content={content} deterministicFallback={deterministicFallback} />;
  }
  return <AnalysisContentLegacy content={content} promptVersion={promptVersion} />;
}

export function AnalysisAsistidoPanel({ session }) {
  const sessionId = session?.id ?? null;
  const isCompleted = session?.status === "completed";

  const [loadingInitial, setLoadingInitial] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [lastFailureCode, setLastFailureCode] = useState(null);
  const [regenFailed, setRegenFailed] = useState(false);
  // v3.4: contexto determinístico para fallback cuando no hay análisis IA
  // exitoso. Se consulta aparte y permite mostrar los bloques determinísticos
  // (actividades, dominios, mood, métricas, comparación, observaciones)
  // aun si Ollama está apagado.
  const [deterministic, setDeterministic] = useState(null);
  const pollTimerRef = useRef(null);
  const cancelledRef = useRef(false);

  function clearPoll() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    clearPoll();
    setAnalysis(null);
    setError("");
    setStatus(null);
    setRegenerating(false);
    setLastFailureCode(null);
    setRegenFailed(false);
    setDeterministic(null);

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

    async function loadDeterministic() {
      try {
        const d = await getAnalysisContext(sessionId);
        if (!cancelled) setDeterministic(d);
      } catch {
        // Silencioso: si el fallback no responde, el panel igual muestra lo
        // que haya (análisis v3 persistido o mensaje de error estándar).
      }
    }

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
          // Si el análisis OK no trae observations (v3.0-3.3), levantar el
          // fallback para completar el bloque Observaciones.
          const needsFallback =
            data.analysis?.content?.schema_version === "3" &&
            !Array.isArray(data.analysis.content.observations);
          if (needsFallback) loadDeterministic();
          if (data?.regenerating) schedulePoll();
          else clearPoll();
        } else if (st === "generating") {
          setAnalysis(null);
          setStatus("generating");
          setRegenerating(false);
          setError("");
          loadDeterministic();
          schedulePoll();
        } else if (st === "last_failed") {
          setAnalysis(null);
          setStatus("last_failed");
          setRegenerating(false);
          setLastFailureCode(data?.error_code || null);
          setError("");
          loadDeterministic();
          clearPoll();
        } else {
          setStatus(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404 && err?.data?.status === "no_analysis") {
          if (noAnalysisRetries < NO_ANALYSIS_RETRIES) {
            noAnalysisRetries += 1;
            schedulePoll(NO_ANALYSIS_RETRY_MS);
            return;
          }
          setStatus("no_analysis");
          setError("");
          loadDeterministic();
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
    setRegenFailed(false);
    try {
      const data = await generateAnalysis(sessionId, { force });
      if (data?.analysis) {
        setAnalysis(data.analysis);
        setStatus("ok");
        setRegenerating(false);
      }
    } catch (err) {
      if (force && analysis && status === "ok") {
        setRegenFailed(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setGenerating(false);
    }
  }

  // Bloques determinísticos a mostrar cuando NO hay análisis OK. Puede
  // provenir del fallback del endpoint /analysis-context.
  const hasDeterministicFallback =
    deterministic &&
    (Array.isArray(deterministic.observations) || Array.isArray(deterministic.activities));

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
            <Loader2 size={16} aria-hidden="true" /> Generando síntesis IA de esta sesión…
          </p>
          <p className="ai-hint">{LOAD_HINT}</p>
          {hasDeterministicFallback && (
            <div className="analysis-body">
              <DeterministicBlocks data={deterministic} />
            </div>
          )}
        </>
      )}

      {sessionId && isCompleted && !loadingInitial && !error && status === "no_analysis" && (
        <>
          {hasDeterministicFallback && (
            <div className="analysis-body">
              <DeterministicBlocks data={deterministic} />
            </div>
          )}
          <p className="ai-hint">
            Todavía no hay síntesis del asistente IA para esta sesión. Podés generarla manualmente.
          </p>
          <div className="activity-actions single">
            <button
              type="button"
              className="primary"
              onClick={() => runGenerate({ force: false })}
              disabled={generating}
            >
              {generating ? (<><Loader2 size={16} aria-hidden="true" /> Generando…</>) : (<><Bot size={16} aria-hidden="true" /> Generar síntesis IA</>)}
            </button>
          </div>
          {generating && (
            <p className="ai-hint" role="status" aria-live="polite">{LOAD_HINT}</p>
          )}
        </>
      )}

      {sessionId && isCompleted && !loadingInitial && !error && status === "last_failed" && (
        <>
          {hasDeterministicFallback && (
            <div className="analysis-body">
              <DeterministicBlocks data={deterministic} />
            </div>
          )}
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" />{" "}
            No se pudo generar la síntesis del asistente IA. Los datos y observaciones automáticas siguen disponibles.
          </div>
          {describeFailure(lastFailureCode) && (
            <p className="ai-hint">Causa del último intento: {describeFailure(lastFailureCode)}</p>
          )}
          <div className="activity-actions single">
            <button
              type="button"
              className="primary"
              onClick={() => runGenerate({ force: false })}
              disabled={generating}
            >
              {generating ? (<><Loader2 size={16} aria-hidden="true" /> Reintentando…</>) : (<><RefreshCw size={16} aria-hidden="true" /> Reintentar síntesis IA</>)}
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
              <Loader2 size={16} aria-hidden="true" /> Regenerando síntesis IA en segundo plano…
            </p>
          )}
          {regenFailed && (
            <div className="error-box" role="alert" data-testid="regen-failed-banner">
              <AlertTriangle size={20} aria-hidden="true" />{" "}
              No se pudo actualizar el análisis. Se conserva la última versión disponible.
            </div>
          )}
          <AnalysisContent
            content={analysis.content}
            promptVersion={analysis.prompt_version}
            deterministicFallback={deterministic}
          />
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
