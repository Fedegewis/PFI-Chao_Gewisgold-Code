import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Clock3, Target, Timer, Trash2, TrendingUp, User } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard } from "../common/MetricCard.jsx";
import { cx } from "../../lib/cx.js";
import { formatLatency, formatShortDate } from "../../lib/format.js";

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

function EvolutionChartBackend({ completedSessions }) {
  if (completedSessions.length < 2) {
    return (
      <div className="empty-chart">
        Se necesita al menos 2 sesiones completadas para mostrar evolución.
      </div>
    );
  }
  const recent = completedSessions.slice(0, 8).slice().reverse();
  return (
    <>
      <div className="sr-only">
        Evolución: {recent.map((s) => `${formatShortDate(s.completed_at)}: ${pctFromRate(s.summary.accuracy)} precisión, ${formatLatency(s.summary.mean_latency_ms)} latencia`).join(". ")}
      </div>
      <div className="evolution-bars" aria-hidden="true">
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

export function BackendPatientDetail({ selectedPatient, sessionsState, onDeletePatient }) {
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

  const totalCompleted = completedSessions.length;
  const precisionValue = lastCompleted ? pctFromRate(lastCompleted.summary.accuracy) : "—";
  const latencyValue = lastCompleted && lastCompleted.summary.mean_latency_ms != null
    ? formatLatency(lastCompleted.summary.mean_latency_ms)
    : "—";

  return (
    <section className="professional-detail" aria-label={`Datos de ${selectedPatient.name}`}>
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
                </dl>
              ) : highlightSession && highlightSession.status === "abandoned" ? (
                <p className="ai-hint">Sesión abandonada — sin métricas registradas.</p>
              ) : highlightSession && highlightSession.status !== "completed" ? (
                <p className="ai-hint">Sesión en progreso — sin métricas todavía.</p>
              ) : (
                <p className="ai-hint">Seleccioná una sesión del historial para ver su detalle.</p>
              )}
            </div>

            <div className="panel">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Análisis asistido</p>
                  <h3>Síntesis clínica</h3>
                </div>
              </div>
              <p className="ai-hint">
                El análisis asistido estará disponible próximamente. Los datos que ves acá provienen exclusivamente de las sesiones reales del paciente.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
