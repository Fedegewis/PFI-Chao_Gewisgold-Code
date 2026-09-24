import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { acceptInvitationApi, lookupInvitationApi } from "../services/invitationsApi.js";

const MIN_PASSWORD_LENGTH = 6;

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

export function InviteAcceptScreen({ token, onAccepted, onGoToLogin }) {
  const [state, setState] = useState({ loading: true, status: null, data: null, error: "" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState({ loading: true, status: null, data: null, error: "" });
      if (!token) {
        if (!cancelled) setState({ loading: false, status: "invalid", data: null, error: "" });
        return;
      }
      try {
        const data = await lookupInvitationApi(token);
        if (cancelled) return;
        setState({ loading: false, status: data?.status || "invalid", data, error: "" });
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404) {
          setState({ loading: false, status: "invalid", data: null, error: "" });
        } else {
          setState({
            loading: false,
            status: null,
            data: null,
            error: err?.message || "No se pudo cargar la invitación.",
          });
        }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setFormError("Las contraseñas no coinciden.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await acceptInvitationApi(token, password);
      if (!result?.user || result.user.role !== "patient" || !result?.token) {
        setFormError("La invitación no pudo aceptarse. Contactá a tu profesional.");
        return;
      }
      onAccepted?.(result);
    } catch (err) {
      const code = err?.data?.status;
      if (code === "expired") setFormError("Esta invitación venció. Pedile a tu profesional una nueva invitación.");
      else if (code === "revoked") setFormError("Esta invitación ya no está disponible. Pedile a tu profesional una nueva invitación.");
      else if (code === "accepted") setFormError("Esta invitación ya fue utilizada. Iniciá sesión con tu email y contraseña.");
      else if (code === "invalid") setFormError("El enlace de invitación no es válido.");
      else if (code === "email_taken") setFormError("El email de la invitación ya está registrado. Contactá a tu profesional.");
      else setFormError(err?.message || "No se pudo aceptar la invitación.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.loading) {
    return (
      <section className="login-layout" aria-label="Cargando invitación">
        <div className="panel login-panel" role="status" aria-live="polite">
          <p className="eyebrow">Invitación</p>
          <h2>Cargando invitación...</h2>
        </div>
      </section>
    );
  }

  if (state.error) {
    return (
      <section className="login-layout" aria-label="Error de invitación">
        <div className="panel login-panel">
          <p className="eyebrow">Invitación</p>
          <h2>No pudimos cargar la invitación</h2>
          <p className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> {state.error}
          </p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const status = state.status;

  if (status === "expired") {
    return (
      <InviteMessage
        title="Invitación vencida"
        message="Esta invitación venció. Pedile a tu profesional una nueva invitación."
        onGoToLogin={onGoToLogin}
      />
    );
  }
  if (status === "revoked") {
    return (
      <InviteMessage
        title="Invitación no disponible"
        message="Esta invitación ya no está disponible. Pedile a tu profesional una nueva invitación."
        onGoToLogin={onGoToLogin}
      />
    );
  }
  if (status === "accepted") {
    return (
      <InviteMessage
        title="Invitación ya utilizada"
        message="Esta invitación ya fue utilizada. Si ya creaste tu cuenta, iniciá sesión."
        onGoToLogin={onGoToLogin}
        showLoginButton
      />
    );
  }
  if (status === "invalid" || !status) {
    return (
      <InviteMessage
        title="Enlace no válido"
        message="El enlace de invitación no es válido."
        onGoToLogin={onGoToLogin}
      />
    );
  }

  const info = state.data || {};

  return (
    <section className="login-layout" aria-label="Aceptar invitación">
      <div className="login-copy">
        <p className="eyebrow"></p>
        <h1>MenteActiva</h1>
        <p>Confirmá tu identidad y creá una contraseña para acceder a las actividades.</p>
      </div>
      <form className="panel login-panel" onSubmit={handleSubmit} noValidate>
        <div className="login-title">
          <ShieldCheck size={34} aria-hidden="true" />
          <div>
            <h2>Aceptar invitación</h2>
            <p>Te invitó {info.professional_name || "tu profesional"}.</p>
          </div>
        </div>

        <dl className="invite-details">
          <dt>Nombre</dt><dd>{info.patient_name}</dd>
          <dt>Email</dt><dd>{info.email}</dd>
          {info.age != null && (<><dt>Edad</dt><dd>{info.age}</dd></>)}
          <dt>Vence</dt><dd>{formatDate(info.expires_at)}</dd>
        </dl>

        <label htmlFor="invite-password">Crear contraseña</label>
        <input
          id="invite-password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setFormError(""); }}
          minLength={MIN_PASSWORD_LENGTH}
        />
        <label htmlFor="invite-password-confirm">Confirmar contraseña</label>
        <input
          id="invite-password-confirm"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value); setFormError(""); }}
          minLength={MIN_PASSWORD_LENGTH}
        />

        {formError && (
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> {formError}
          </div>
        )}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting
            ? "Creando acceso..."
            : (<><CheckCircle2 size={20} aria-hidden="true" /> Aceptar invitación</>)}
        </button>
      </form>
    </section>
  );
}

function InviteMessage({ title, message, onGoToLogin, showLoginButton }) {
  return (
    <section className="login-layout" aria-label={title}>
      <div className="panel login-panel">
        <p className="eyebrow">Invitación</p>
        <h2>{title}</h2>
        <p>{message}</p>
        {(showLoginButton || onGoToLogin) && (
          <button type="button" className="primary" onClick={onGoToLogin}>
            Ir al inicio de sesión
          </button>
        )}
      </div>
    </section>
  );
}
