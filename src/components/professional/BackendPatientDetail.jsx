import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Clock3, Target, Timer, Trash2, TrendingUp, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "../common/MetricCard.jsx";
import { AnalysisAsistidoPanel } from "./AnalysisAsistidoPanel.jsx";
import { TrainingConfigPanel } from "./TrainingConfigPanel.jsx";
import { PatientAccessPanel } from "./PatientAccessPanel.jsx";
import { MedicalDisclaimerBanner } from "../common/MedicalDisclaimer.jsx";
import { cx } from "../../lib/cx.js";
import { formatLatency, formatShortDate } from "../../lib/format.js";
import { formatAdaptiveSummary } from "../../lib/adaptiveFormat.js";

const STATUS_LABEL = {
  completed: "Completada",
  abandoned: "Abandonada",
  in_progress: "En progreso",
  created: "Iniciada",
};

const STATUS_CHIP = {
  completed: "status-chip--good",
  abandoned: "status-chip--muted",
  in_progress: "status-chip--warn",
  created: "status-chip--warn",
};

function pctFromRate(rate) {
  if (rate == null) return "—";
  return `${Math.round(Number(rate) * 100)}%`;
}

// Estados que el profesional puede eliminar (espejo de
// DELETABLE_SESSION_STATUSES en el backend, que es quien valida). Las
// sesiones completadas nunca se eliminan.
const DELETABLE_STATUSES = new Set(["created", "in_progress", "abandoned"]);

function isSessionDeletable(session) {
  return Boolean(session) && DELETABLE_STATUSES.has(session.status);
}

function sessionDate(session) {
  return session.completed_at || session.abandoned_at || session.started_at || session.created_at;
}

// Mapeo slug → label legible para el profesional. Los slugs coinciden con el
// CHECK constraint de sessions.patient_reported_mood (migración 014) y con
// MOOD_OPTIONS del frontend. Si la sesión no tiene mood (null) el detalle
// omite el bloque enteramente — no muestra "Sin datos" ni "No registrado".
const MOOD_LABELS = {
  alegria: "Alegría",
  bien: "Bien",
  calma: "Calma",
  cansancio: "Cansancio",
  tristeza: "Tristeza",
};

// Ajuste de dificultad de la sesión (mecanismo adaptativo v1). Se muestra en
// TODAS las sesiones: las anteriores al mecanismo (o sin nivel registrado) no
// tienen datos de adaptación y lo dicen explícitamente; no se infiere ni se
// inventa un nivel.
function AdaptiveDecisionDetails({ adaptive }) {
  const summary = formatAdaptiveSummary(adaptive);
  if (!summary) {
    return (
      <div className="analysis-block" data-testid="adaptive-decision-unavailable">
        <p className="eyebrow">Ajuste de dificultad</p>
        <p className="ai-hint">Adaptación no disponible para esta sesión.</p>
      </div>
    );
  }
  return (
    <div className="analysis-block" data-testid="adaptive-decision">
      <p className="eyebrow">Ajuste de dificultad</p>
      <dl className="invite-details">
        <dt>Nivel utilizado</dt><dd>{summary.level}</dd>
        <dt>Cambio</dt><dd>{summary.change}</dd>
        <dt>Motivo</dt><dd>{summary.reason}</dd>
        <dt>Evidencia utilizada</dt><dd>{summary.evidence}</dd>
        {summary.mix && (
          <>
            <dt>Preguntas por dificultad</dt>
            <dd>
              {summary.mix}
              {summary.usedFallback && summary.target ? ` (objetivo: ${summary.target}; no había suficientes preguntas disponibles y se completó con dificultades cercanas)` : ""}
            </dd>
          </>
        )}
      </dl>
      <p className="ai-hint">Regla operativa de la aplicación basada en la precisión de sesiones anteriores de esta actividad. No constituye una evaluación clínica.</p>
    </div>
  );
}

// Diálogo de confirmación para eliminar una sesión. Foco inicial en
// "Cancelar" (opción segura), Escape cierra, Tab queda dentro del diálogo.
function DeleteSessionDialog({ session, deleting, error, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!deleting) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = Array.from(dialogRef.current?.querySelectorAll("button:not([disabled])") || []);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const label = STATUS_LABEL[session.status] || session.status;
  return (
    <div className="ai-modal-backdrop" onClick={() => { if (!deleting) onCancel(); }}>
      <div
        ref={dialogRef}
        className="ai-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-session-title"
        aria-describedby="delete-session-description"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="ai-modal-header">
          <div>
            <p className="eyebrow">Acción irreversible</p>
            <h3 id="delete-session-title">Eliminar sesión del {formatShortDate(sessionDate(session))}</h3>
          </div>
        </div>
        <div className="ai-modal-body">
          <p id="delete-session-description">
            Se eliminará definitivamente esta sesión ({label.toLowerCase()}) junto con sus preguntas
            asignadas y las respuestas registradas. Esta acción no se puede deshacer. Las sesiones
            completadas no se ven afectadas.
          </p>
          {error && (<p className="form-feedback form-feedback-error" role="alert">{error}</p>)}
          <div className="modal-actions">
            <button type="button" ref={cancelRef} onClick={onCancel} disabled={deleting}>Cancelar</button>
            <button type="button" className="danger" onClick={onConfirm} disabled={deleting} aria-busy={deleting}>
              {deleting ? "Eliminando..." : "Sí, eliminar sesión"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EvolutionChartBackend({ completedSessions }) {
  const barsRef = useRef(null);
  const [overflow, setOverflow] = useState(false);
  const recent = completedSessions.length < 2
    ? null
    : completedSessions.slice(0, 8).slice().reverse();

  useEffect(() => {
    const el = barsRef.current;
    if (!el) return undefined;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recent]);

  if (!recent) {
    return (
      <div className="empty-chart">
        Se necesita al menos 2 sesiones completadas para mostrar evolución.
      </div>
    );
  }

  return (
    <>
      <div className="sr-only">
        Evolución: {recent.map((s) => `${formatShortDate(s.completed_at)}: ${pctFromRate(s.summary.accuracy)} precisión, ${formatLatency(s.summary.mean_latency_ms)} latencia`).join(". ")}
      </div>
      <div className="evolution-bars" ref={barsRef} aria-hidden="true">
        {recent.map((session) => {
          const acc = session.summary.accuracy != null ? Math.round(session.summary.accuracy * 100) : 0;
          return (
            <div key={session.id} className="evolution-slot">
              <span className="evolution-value">{acc}%</span>
              <span
                className={cx("evolution-bar", acc >= 70 ? "bar-high" : acc >= 50 ? "bar-mid" : "bar-low")}
                style={{ height: `${Math.max(8, acc)}%` }}
                title={`Sesión ${session.id} - ${acc}% - ${formatLatency(session.summary.mean_latency_ms)}`}
              />
              <small>{formatShortDate(session.completed_at)}</small>
            </div>
          );
        })}
      </div>
      {overflow && (
        <p className="scroll-hint" aria-hidden="true">Deslizá para ver más sesiones →</p>
      )}
    </>
  );
}

function SessionHistoryTable({ sessions, selectedId, onSelect }) {
  if (sessions.length === 0) {
    return <p className="ai-hint">Todavía no hay actividades registradas.</p>;
  }
  return (
    <div className="session-table-wrap">
      <div className="session-table" role="table" aria-label="Historial de sesiones">
        <div className="session-table-head" role="row">
          <span role="columnheader">Fecha</span>
          <span role="columnheader">Estado</span>
          <span role="columnheader">Precisión</span>
          <span role="columnheader">Latencia media</span>
        </div>
        <div role="rowgroup">
          {sessions.map((s) => {
            const isCompleted = s.status === "completed";
            const dateSource = s.completed_at || s.abandoned_at || s.started_at || s.created_at;
            return (
              <button
                key={s.id}
                type="button"
                className={cx("session-table-row session-table-row--interactive", selectedId === s.id && "session-table-row--selected")}
                role="row"
                onClick={() => onSelect(s)}
                aria-pressed={selectedId === s.id}
              >
                <span role="cell">{formatShortDate(dateSource)}</span>
                <span role="cell">
                  <span className={cx("status-chip", STATUS_CHIP[s.status])}>{STATUS_LABEL[s.status] || s.status}</span>
                </span>
                <span role="cell">{isCompleted ? pctFromRate(s.summary?.accuracy) : "—"}</span>
                <span role="cell">{isCompleted && s.summary?.mean_latency_ms != null ? formatLatency(s.summary.mean_latency_ms) : "—"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function BackendPatientDetail({ selectedPatient, sessionsState, onDeletePatient, onDeleteSession }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleConfirmDelete() {
    if (!onDeletePatient) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDeletePatient();
      setConfirmingDelete(false);
    } catch (err) {
      setDeleteError(err?.message || "No se pudo eliminar el paciente.");
    } finally {
      setDeleting(false);
    }
  }

  const list = sessionsState?.list;
  const isLoadingForCurrent = sessionsState?.loading && sessionsState.patientId === selectedPatient.id;
  const errorForCurrent = sessionsState?.error && sessionsState.patientId === selectedPatient.id ? sessionsState.error : "";
  const listForCurrent = list && sessionsState.patientId === selectedPatient.id ? list : null;

  const completedSessions = useMemo(
    () => (listForCurrent || []).filter((s) => s.status === "completed" && s.summary),
    [listForCurrent]
  );
  const lastCompleted = completedSessions[0] || null;

  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const highlightId = selectedSessionId ?? lastCompleted?.id ?? null;
  const highlightSession = useMemo(
    () => (listForCurrent || []).find((s) => s.id === highlightId) || null,
    [listForCurrent, highlightId]
  );
  const highlightSummary = highlightSession?.summary || null;

  // Eliminación de sesión. `deletingSessionRef` evita el doble envío aun si
  // dos clics llegan antes de que React re-renderice el botón deshabilitado.
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [sessionDeleteError, setSessionDeleteError] = useState("");
  const [sessionFeedback, setSessionFeedback] = useState("");
  const deletingSessionRef = useRef(false);
  const deleteTriggerRef = useRef(null);
  const feedbackRef = useRef(null);

  // Al cambiar de paciente se descartan selección, diálogo y avisos.
  useEffect(() => {
    setSessionFeedback("");
    setSessionToDelete(null);
    setSelectedSessionId(null);
  }, [selectedPatient.id]);

  const closeDeleteDialog = useCallback(() => {
    setSessionToDelete(null);
    setSessionDeleteError("");
    deleteTriggerRef.current?.focus();
  }, []);

  async function handleConfirmDeleteSession() {
    if (!sessionToDelete || !onDeleteSession || deletingSessionRef.current) return;
    deletingSessionRef.current = true;
    setDeletingSession(true);
    setSessionDeleteError("");
    const deletedId = sessionToDelete.id;
    try {
      await onDeleteSession(deletedId);
      setSelectedSessionId((current) => (current === deletedId ? null : current));
      setSessionToDelete(null);
      setSessionFeedback("La sesión se eliminó correctamente.");
      // El botón que abrió el diálogo ya no existe: el foco va al aviso.
      setTimeout(() => feedbackRef.current?.focus(), 0);
    } catch (err) {
      setSessionDeleteError(
        err?.status === 409
          ? "La sesión cambió de estado y ya no se puede eliminar. Actualizá el historial."
          : err?.status === 404
            ? "La sesión ya no existe. Actualizá el historial."
            : err?.message || "No se pudo eliminar la sesión."
      );
    } finally {
      deletingSessionRef.current = false;
      setDeletingSession(false);
    }
  }

  const totalCompleted = completedSessions.length;
  const precisionValue = lastCompleted ? pctFromRate(lastCompleted.summary.accuracy) : "—";
  const latencyValue = lastCompleted && lastCompleted.summary.mean_latency_ms != null
    ? formatLatency(lastCompleted.summary.mean_latency_ms)
    : "—";

  return (
    <section className="professional-detail" aria-label={`Datos de ${selectedPatient.name}`}>
      <MedicalDisclaimerBanner />
      <header className="detail-topbar">
        <div>
          <p className="eyebrow">Ficha del usuario</p>
          <h2>{selectedPatient.name}</h2>
          <small>
            {selectedPatient.age ? `${selectedPatient.age} años · ` : ""}
            {totalCompleted > 0
              ? `${totalCompleted} actividad${totalCompleted === 1 ? "" : "es"} completada${totalCompleted === 1 ? "" : "s"}`
              : "Sin actividades completadas todavía"}
          </small>
          {selectedPatient.email && (
            <small
              className="patient-detail-email"
              title={selectedPatient.email}
              style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
            >
              {selectedPatient.email}
            </small>
          )}
        </div>
        {onDeletePatient && (
          <button
            type="button"
            className="danger"
            onClick={() => { setConfirmingDelete(true); setDeleteError(""); }}
            aria-label={`Eliminar paciente ${selectedPatient.name}`}
          >
            <Trash2 size={18} aria-hidden="true" /> Eliminar paciente
          </button>
        )}
      </header>

      {confirmingDelete && (
        <div className="ai-modal-backdrop" onClick={() => { if (!deleting) setConfirmingDelete(false); }}>
          <div className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="delete-patient-title" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <div>
                <p className="eyebrow">Acción irreversible</p>
                <h3 id="delete-patient-title">Eliminar a {selectedPatient.name}</h3>
              </div>
            </div>
            <div className="ai-modal-body">
              <p>
                Se eliminarán definitivamente el usuario del paciente y todos sus datos asociados
                (sesiones, respuestas y resultados). Esta acción no se puede deshacer y el paciente
                perderá acceso a MenteActiva.
              </p>
              {deleteError && (<p className="form-feedback form-feedback-error" role="alert">{deleteError}</p>)}
              <div className="modal-actions">
                <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancelar</button>
                <button type="button" className="danger" onClick={handleConfirmDelete} disabled={deleting}>
                  {deleting ? "Eliminando..." : "Sí, eliminar definitivamente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sessionToDelete && (
        <DeleteSessionDialog
          session={sessionToDelete}
          deleting={deletingSession}
          error={sessionDeleteError}
          onCancel={closeDeleteDialog}
          onConfirm={handleConfirmDeleteSession}
        />
      )}

      <div className="metric-grid">
        <MetricCard icon={User} label="Usuario" value={selectedPatient.name.split(" ")[0]} detail={selectedPatient.age ? `${selectedPatient.age} años` : "—"} />
        <MetricCard icon={Target} label="Precisión (última)" value={precisionValue} detail={lastCompleted ? formatShortDate(lastCompleted.completed_at) : "Sin datos"} />
        <MetricCard icon={Timer} label="Tiempo medio (última)" value={latencyValue} detail="respuesta" />
        <MetricCard icon={CheckCircle2} label="Completadas" value={String(totalCompleted)} detail="reales" />
        <MetricCard icon={CalendarDays} label="Sesiones totales" value={String((listForCurrent || []).length)} detail="historial" />
      </div>

      {isLoadingForCurrent && (
        <div className="panel" role="status" aria-live="polite">
          <p className="ai-hint">Cargando historial de sesiones...</p>
        </div>
      )}
      {errorForCurrent && (
        <div className="panel">
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> {errorForCurrent}
          </div>
        </div>
      )}

      <p
        ref={feedbackRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={sessionFeedback ? "form-feedback form-feedback-success" : "sr-only"}
      >
        {sessionFeedback}
      </p>

      {!isLoadingForCurrent && !errorForCurrent && (
        <div className="detail-columns">
          <div className="detail-col">
            <div className="panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Evolución del rendimiento</p>
                  <h3>Precisión por sesión</h3>
                </div>
                <TrendingUp size={26} aria-hidden="true" />
              </div>
              <EvolutionChartBackend completedSessions={completedSessions} />
            </div>

            <div className="panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Historial de actividades</p>
                  <h3>Sesiones reales</h3>
                </div>
                <Clock3 size={22} aria-hidden="true" />
              </div>
              <SessionHistoryTable
                sessions={listForCurrent || []}
                selectedId={highlightId}
                onSelect={(s) => setSelectedSessionId(s.id)}
              />
              <hr className="panel-divider" />
              <TrainingConfigPanel patientId={selectedPatient.id} />
              <hr className="panel-divider" />
              <PatientAccessPanel key={selectedPatient.id} patientId={selectedPatient.id} />
            </div>
          </div>

          <div className="detail-col">
            <div className="panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Detalle de la sesión</p>
                  <h3>{highlightSession
                    ? formatShortDate(highlightSession.completed_at || highlightSession.abandoned_at || highlightSession.created_at)
                    : "Sin datos"}</h3>
                </div>
                <BarChart3 size={26} aria-hidden="true" />
              </div>
              {highlightSession && highlightSession.status === "completed" && highlightSummary ? (
                <dl className="invite-details">
                  <dt>Preguntas</dt><dd>{highlightSummary.total_questions}</dd>
                  <dt>Respondidas</dt><dd>{highlightSummary.answered_questions}</dd>
                  <dt>Correctas</dt><dd>{highlightSummary.correct_count}</dd>
                  <dt>Incorrectas</dt><dd>{highlightSummary.incorrect_count}</dd>
                  <dt>Precisión</dt><dd>{pctFromRate(highlightSummary.accuracy)}</dd>
                  <dt>Completitud</dt><dd>{pctFromRate(highlightSummary.completion_rate)}</dd>
                  <dt>Latencia media</dt><dd>{highlightSummary.mean_latency_ms != null ? formatLatency(highlightSummary.mean_latency_ms) : "—"}</dd>
                  {MOOD_LABELS[highlightSession.patient_reported_mood] && (
                    <>
                      <dt>Estado de ánimo registrado</dt>
                      <dd>{MOOD_LABELS[highlightSession.patient_reported_mood]}</dd>
                    </>
                  )}
                </dl>
              ) : highlightSession && highlightSession.status === "abandoned" ? (
                <p className="ai-hint">Sesión abandonada — sin métricas registradas.</p>
              ) : highlightSession && highlightSession.status !== "completed" ? (
                <p className="ai-hint">Sesión en progreso — sin métricas todavía.</p>
              ) : (
                <p className="ai-hint">Seleccioná una sesión del historial para ver su detalle.</p>
              )}
              {highlightSession && <AdaptiveDecisionDetails adaptive={highlightSession.adaptive} />}
              {onDeleteSession && isSessionDeletable(highlightSession) && (
                <div className="modal-actions">
                  <button
                    type="button"
                    className="danger"
                    ref={deleteTriggerRef}
                    onClick={() => { setSessionFeedback(""); setSessionDeleteError(""); setSessionToDelete(highlightSession); }}
                    disabled={deletingSession}
                    aria-label={`Eliminar sesión del ${formatShortDate(sessionDate(highlightSession))} (${STATUS_LABEL[highlightSession.status] || highlightSession.status})`}
                  >
                    <Trash2 size={18} aria-hidden="true" /> Eliminar sesión
                  </button>
                </div>
              )}
            </div>

            <AnalysisAsistidoPanel session={highlightSession} />
          </div>
        </div>
      )}
    </section>
  );
}
