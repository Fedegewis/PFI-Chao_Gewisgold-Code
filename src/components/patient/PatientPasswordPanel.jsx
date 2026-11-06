import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { MIN_PASSWORD_LENGTH, newPasswordError } from "../../lib/passwordRules.js";
import { fetchOwnPasswordStatus, saveOwnPassword } from "../../services/patientsApi.js";

// Opción B — el paciente con la sesión abierta crea su contraseña para poder
// volver a ingresar sin depender del enlace por correo. Si ya tiene una,
// puede cambiarla escribiendo la actual (lo exige el backend).
export function PatientPasswordPanel({ className }) {
  const baseId = useId();
  const [hasPassword, setHasPassword] = useState(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOwnPasswordStatus()
      .then((data) => { if (!cancelled) setHasPassword(data.has_password === true); })
      .catch(() => { if (!cancelled) setHasPassword(null); });
    return () => { cancelled = true; };
  }, []);

  function reset() {
    setOpen(false);
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("");
    if (hasPassword && !current) {
      setError("Escribí tu contraseña actual.");
      return;
    }
    const invalid = newPasswordError(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await saveOwnPassword(password, hasPassword ? current : undefined);
      reset();
      setHasPassword(true);
      setStatus(
        result.password_action === "replaced"
          ? "Listo, tu contraseña fue cambiada."
          : "Listo. La próxima vez podés ingresar con tu correo y esta contraseña."
      );
    } catch (err) {
      setError(err?.message || "No se pudo guardar la contraseña. Intentá nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  // Si no se pudo consultar el estado, no se muestra nada (no bloquea la pantalla).
  if (hasPassword === null) return null;

  return (
    <section className={["panel", "patient-password", className].filter(Boolean).join(" ")} aria-labelledby={`${baseId}-title`}>
      <h3 id={`${baseId}-title`}><KeyRound size={20} aria-hidden="true" /> Tu contraseña</h3>
      <p className="training-hint">
        {hasPassword
          ? "Podés ingresar con tu correo y tu contraseña."
          : "Todavía no tenés contraseña. Si la creás, vas a poder volver a ingresar con tu correo y contraseña, sin esperar un enlace."}
      </p>

      {!open && (
        <button type="button" className={hasPassword ? undefined : "primary"} onClick={() => { setStatus(""); setOpen(true); }}>
          {hasPassword ? "Cambiar contraseña" : "Crear contraseña"}
        </button>
      )}

      {open && (
        <form className="patient-password__form" onSubmit={handleSubmit} noValidate>
          {hasPassword && (
            <>
              <label htmlFor={`${baseId}-current`}>Contraseña actual</label>
              <input
                id={`${baseId}-current`}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => { setCurrent(e.target.value); setError(""); }}
              />
            </>
          )}
          <label htmlFor={`${baseId}-new`}>{hasPassword ? "Nueva contraseña" : "Contraseña"}</label>
          <input
            id={`${baseId}-new`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            minLength={MIN_PASSWORD_LENGTH}
          />
          <label htmlFor={`${baseId}-confirm`}>Repetir contraseña</label>
          <input
            id={`${baseId}-confirm`}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setError(""); }}
            minLength={MIN_PASSWORD_LENGTH}
          />
          <p className="training-hint">Al menos {MIN_PASSWORD_LENGTH} caracteres.</p>
          {error && (
            <p className="form-feedback form-feedback-error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" /> {error}
            </p>
          )}
          <div className="patient-password__actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar contraseña"}
            </button>
            <button type="button" onClick={reset} disabled={saving}>Cancelar</button>
          </div>
        </form>
      )}

      <div aria-live="polite">
        {status && (
          <p className="form-feedback form-feedback-success">
            <CheckCircle2 size={14} aria-hidden="true" /> {status}
          </p>
        )}
      </div>
    </section>
  );
}
