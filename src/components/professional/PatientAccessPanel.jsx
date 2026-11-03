import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchPatientAccess, savePatientAccess } from "../../services/patientsApi.js";

// F1 — Permiso de acceso sin contraseña por paciente.
//
// El flujo de enlaces por correo todavía no existe (llega en F2). El permiso
// se puede guardar por adelantado, pero se presenta como "Próximamente" y se
// aclara que el paciente sigue entrando con su contraseña, para que el
// profesional no asuma que ya hay un método de ingreso nuevo disponible. El
// backend informa la disponibilidad real en `passwordless_login_available`.

const DESCRIPTION =
  "Cuando esta opción esté disponible, el paciente podrá ingresar mediante un enlace seguro enviado a su correo electrónico.";
const NOT_YET_AVAILABLE =
  "Todavía no está disponible: por ahora el paciente sigue ingresando con su contraseña. Podés dejar el permiso configurado de antemano.";

export function PatientAccessPanel({ patientId }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [access, setAccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setLoadError("");
    setStatus("");
    setSaveError("");
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

  async function handleToggle(event) {
    const next = event.target.checked;
    setSaving(true);
    setStatus("");
    setSaveError("");
    try {
      const updated = await savePatientAccess(patientId, next);
      setAccess(updated);
      setStatus(updated.allow_passwordless ? "Permiso activado y guardado." : "Permiso desactivado y guardado.");
    } catch (err) {
      setSaveError(
        `No se pudo guardar el cambio. ${err?.message || "Intentá nuevamente."}`.trim()
      );
    } finally {
      setSaving(false);
    }
  }

  const available = access?.passwordless_login_available === true;
  const checkboxId = `patient-access-passwordless-${patientId}`;
  const descriptionId = `${checkboxId}-desc`;

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
              disabled={saving}
              aria-describedby={descriptionId}
            />
            <div className="access-toggle__text">
              <label htmlFor={checkboxId} className="access-toggle__label">
                Permitir acceso sin contraseña
                {!available && <span className="access-toggle__badge">Próximamente</span>}
              </label>
              <p id={descriptionId} className="training-hint">
                {DESCRIPTION}
                {!available && <> {NOT_YET_AVAILABLE}</>}
              </p>
            </div>
          </div>

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
