import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH, newPasswordError } from "../../lib/passwordRules.js";
import {
  fetchPatientAccess,
  revokePatientSessions,
  savePatientAccess,
  setPatientPasswordByProfessional,
} from "../../services/patientsApi.js";

// F1 + F2/F3 — Permiso de acceso sin contraseña por paciente.
//
// El backend informa si el flujo de enlaces está disponible en este
// despliegue (`passwordless_login_available`), si el paciente tiene
// contraseña (`has_password`) y cuántas sesiones abiertas con enlace tiene
// (`active_sessions`). Las reglas se validan en el backend; esta pantalla
// sólo las anticipa para informar al profesional:
// - D5: no se puede desactivar el enlace si es el único método de acceso.
// - E2: desactivar el enlace cierra las sesiones abiertas; se avisa ANTES y
//   se pide confirmación explícita.

const DESCRIPTION_AVAILABLE =
  "El paciente puede pedir, en la pantalla de ingreso, un enlace que llega a su correo. El enlace vence en 30 minutos y sirve una sola vez; la sesión queda abierta en ese dispositivo hasta 30 días.";
const DESCRIPTION_PENDING =
  "Cuando esta opción esté disponible, el paciente podrá ingresar mediante un enlace seguro enviado a su correo electrónico.";
const NOT_YET_AVAILABLE =
  "Todavía no está disponible: por ahora el paciente sigue ingresando con su contraseña. Podés dejar el permiso configurado de antemano.";

function sessionsLabel(n) {
  return n === 1 ? "1 sesión abierta" : `${n} sesiones abiertas`;
}

export function PatientAccessPanel({ patientId }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [access, setAccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  // E2: confirmación pendiente antes de desactivar ({ activeSessions }).
  const [pendingDisable, setPendingDisable] = useState(null);
  // Opción A: formulario para crear/cambiar la contraseña ({ password, confirm, error }).
  const [passwordForm, setPasswordForm] = useState(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setLoadError("");
    setStatus("");
    setSaveError("");
    setPendingDisable(null);
    setPasswordForm(null);
    try {
      setAccess(await fetchPatientAccess(patientId));
    } catch (err) {
      setAccess(null);
      setLoadError(err?.message || "No se pudo cargar la configuración de acceso.");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(next, { confirmRevokeSessions = false } = {}) {
    setSaving(true);
    setStatus("");
    setSaveError("");
    try {
      const updated = await savePatientAccess(patientId, next, { confirmRevokeSessions });
      setAccess(updated);
      setPendingDisable(null);
      if (updated.allow_passwordless) {
        setStatus("Permiso activado y guardado.");
      } else if (updated.revoked_sessions > 0) {
        const n = updated.revoked_sessions;
        setStatus(`Permiso desactivado y guardado. Se cerraron ${n === 1 ? "1 sesión" : `${n} sesiones`}.`);
      } else {
        setStatus("Permiso desactivado y guardado.");
      }
    } catch (err) {
      const code = err?.data?.status;
      if (code === "confirmation_required") {
        setPendingDisable({ activeSessions: err.data.active_sessions || 1 });
      } else if (code === "last_access_method") {
        setSaveError("No se puede desactivar: es el único método de acceso de este paciente.");
      } else {
        setSaveError(`No se pudo guardar el cambio. ${err?.message || "Intentá nuevamente."}`.trim());
      }
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(event) {
    const next = event.target.checked;
    if (!next && access?.active_sessions > 0) {
      // E2: informar antes de revocar.
      setStatus("");
      setSaveError("");
      setPendingDisable({ activeSessions: access.active_sessions });
      return;
    }
    save(next);
  }

  async function handleRevokeSessions() {
    setSaving(true);
    setStatus("");
    setSaveError("");
    try {
      const updated = await revokePatientSessions(patientId);
      setAccess(updated);
      setStatus("Se cerraron las sesiones abiertas con enlace.");
    } catch (err) {
      setSaveError(`No se pudieron cerrar las sesiones. ${err?.message || "Intentá nuevamente."}`.trim());
    } finally {
      setSaving(false);
    }
  }

  function openPasswordForm() {
    setStatus("");
    setSaveError("");
    setPasswordForm({ password: "", confirm: "", error: "" });
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const error = newPasswordError(passwordForm.password, passwordForm.confirm);
    if (error) {
      setPasswordForm({ ...passwordForm, error });
      return;
    }
    setSaving(true);
    setStatus("");
    setSaveError("");
    try {
      const updated = await setPatientPasswordByProfessional(patientId, passwordForm.password);
      setAccess(updated);
      setPasswordForm(null);
      setStatus(
        updated.password_action === "replaced"
          ? "Contraseña cambiada. La anterior ya no sirve."
          : "Contraseña creada. El paciente ya puede ingresar con su correo y esta contraseña."
      );
    } catch (err) {
      setPasswordForm({ ...passwordForm, error: err?.message || "No se pudo guardar la contraseña." });
    } finally {
      setSaving(false);
    }
  }

  const available = access?.passwordless_login_available === true;
  const onlyMethod = access?.allow_passwordless === true && access?.has_password === false;
  const activeSessions = access?.active_sessions || 0;
  const checkboxId = `patient-access-passwordless-${patientId}`;
  const descriptionId = `${checkboxId}-desc`;
  const onlyMethodId = `${checkboxId}-only`;

  return (
    <section className="training-config-inline" aria-label="Acceso del paciente">
      <header className="training-config-inline__head">
        <div>
          <p className="eyebrow">Acceso del paciente</p>
          <h3>Forma de ingreso</h3>
        </div>
        <KeyRound size={22} aria-hidden="true" />
      </header>

      {loading && <p className="ai-hint" role="status">Cargando configuración de acceso…</p>}

      {!loading && loadError && (
        <div className="training-actions">
          <p className="form-feedback form-feedback-error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" /> {loadError}
          </p>
          <button type="button" onClick={load}>Reintentar</button>
        </div>
      )}

      {!loading && !loadError && access && (
        <div className="training-config-inline__body">
          <div className="access-toggle">
            <input
              id={checkboxId}
              type="checkbox"
              className="access-toggle__input"
              checked={access.allow_passwordless}
              onChange={handleToggle}
              disabled={saving || onlyMethod || Boolean(pendingDisable)}
              aria-describedby={onlyMethod ? `${descriptionId} ${onlyMethodId}` : descriptionId}
            />
            <div className="access-toggle__text">
              <label htmlFor={checkboxId} className="access-toggle__label">
                Permitir acceso sin contraseña
                {!available && <span className="access-toggle__badge">Próximamente</span>}
              </label>
              <p id={descriptionId} className="training-hint">
                {available ? DESCRIPTION_AVAILABLE : DESCRIPTION_PENDING}
                {!available && <> {NOT_YET_AVAILABLE}</>}
              </p>
              {onlyMethod && (
                <p id={onlyMethodId} className="training-hint">
                  Es el único método de acceso de este paciente (no tiene contraseña), por eso no se puede desactivar. Podés crearle una contraseña más abajo.
                </p>
              )}
            </div>
          </div>

          {pendingDisable && (
            <div className="access-confirm" role="alertdialog" aria-labelledby={`${checkboxId}-confirm`}>
              <p id={`${checkboxId}-confirm`}>
                <strong>El paciente tiene {sessionsLabel(pendingDisable.activeSessions)} con enlace.</strong>{" "}
                Si desactivás el acceso sin contraseña, esas sesiones se van a cerrar y el paciente tendrá que ingresar con su contraseña.
              </p>
              <div className="access-confirm__actions">
                <button type="button" className="danger" onClick={() => save(false, { confirmRevokeSessions: true })} disabled={saving}>
                  Desactivar y cerrar sesiones
                </button>
                <button type="button" onClick={() => setPendingDisable(null)} disabled={saving}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="access-password">
            <p className="training-hint">
              <strong>Contraseña:</strong>{" "}
              {access.has_password
                ? "el paciente puede ingresar con su correo y contraseña."
                : "el paciente todavía no tiene contraseña."}
            </p>
            {!passwordForm ? (
              <div>
                <button type="button" onClick={openPasswordForm} disabled={saving}>
                  {access.has_password ? "Cambiar contraseña" : "Crear contraseña"}
                </button>
              </div>
            ) : (
              <form className="access-password__form" onSubmit={handlePasswordSubmit} noValidate>
                <p className="training-hint">
                  Útil si el paciente no puede recibir el enlace en su correo. Después compartí la contraseña con el paciente por un medio seguro.
                </p>
                <label htmlFor={`${checkboxId}-pw`}>Nueva contraseña</label>
                <input
                  id={`${checkboxId}-pw`}
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.password}
                  onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value, error: "" })}
                  minLength={MIN_PASSWORD_LENGTH}
                />
                <label htmlFor={`${checkboxId}-pw2`}>Repetir contraseña</label>
                <input
                  id={`${checkboxId}-pw2`}
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value, error: "" })}
                  minLength={MIN_PASSWORD_LENGTH}
                />
                {passwordForm.error && (
                  <p className="form-feedback form-feedback-error" role="alert">
                    <AlertTriangle size={14} aria-hidden="true" /> {passwordForm.error}
                  </p>
                )}
                <div className="access-confirm__actions">
                  <button type="submit" className="primary" disabled={saving}>Guardar contraseña</button>
                  <button type="button" onClick={() => setPasswordForm(null)} disabled={saving}>Cancelar</button>
                </div>
              </form>
            )}
          </div>

          {activeSessions > 0 && !pendingDisable && (
            <div className="access-sessions">
              <p className="training-hint">Sesiones abiertas con enlace: {activeSessions}.</p>
              <div>
                <button type="button" onClick={handleRevokeSessions} disabled={saving}>
                  Cerrar sesiones abiertas
                </button>
              </div>
            </div>
          )}

          <div aria-live="polite">
            {saving && <p className="ai-hint">Guardando…</p>}
            {!saving && status && (
              <p className="form-feedback form-feedback-success">
                <CheckCircle2 size={14} aria-hidden="true" /> {status}
              </p>
            )}
          </div>
          {saveError && (
            <p className="form-feedback form-feedback-error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" /> {saveError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
