import { AlertTriangle, CheckCircle2, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { acceptInvitationApi, lookupInvitationApi } from "../services/invitationsApi.js";
import { acceptInvitationWithoutPassword, isSameOriginApi } from "../services/authService.js";
import { MedicalDisclaimerLink } from "../components/common/MedicalDisclaimer.jsx";

const MIN_PASSWORD_LENGTH = 6;

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

// Si el backend lo permite (acceso por enlace habilitado y API en el mismo
// origen para la cookie), la persona entra directo con «Ingresar», sin crear
// una contraseña. Puede elegir crear una igual. No se acepta automáticamente
// al abrir el enlace: los programas que revisan correos no la consumen.
function translateAcceptError(err) {
  const code = err?.data?.status || err?.code;
  if (code === "expired") return "Esta invitación venció. Pedile a tu profesional una nueva invitación.";
  if (code === "revoked") return "Esta invitación ya no está disponible. Pedile a tu profesional una nueva invitación.";
  if (code === "accepted") return "Esta invitación ya fue utilizada. Iniciá sesión desde la pantalla de ingreso.";
  if (code === "invalid") return "El enlace de invitación no es válido.";
  if (code === "email_taken") return "El email de la invitación ya está registrado. Contactá a tu profesional.";
  return null;
}

export function InviteAcceptScreen({ token, onAccepted, onAcceptedWithoutPassword, onGoToLogin }) {
  const [state, setState] = useState({ loading: true, status: null, data: null, error: "" });
  const [usePassword, setUsePassword] = useState(false);
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
      setFormError(translateAcceptError(err) || err?.message || "No se pudo aceptar la invitación.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnterWithoutPassword() {
    if (submitting) return;
    setFormError("");
    setSubmitting(true);
    try {
      const data = await acceptInvitationWithoutPassword(token);
      onAcceptedWithoutPassword?.(data);
    } catch (err) {
      if (err?.status === 503) {
        // El acceso sin contraseña se apagó entre la carga y el clic.
        setUsePassword(true);
        setFormError("El ingreso directo no está disponible en este momento. Creá una contraseña para continuar.");
      } else {
        setFormError(translateAcceptError(err) || err?.message || "No se pudo aceptar la invitación.");
      }
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
  const directAvailable = info.passwordless_available === true && isSameOriginApi() && Boolean(onAcceptedWithoutPassword);

  if (directAvailable && !usePassword) {
    return (
      <section className="login-layout" aria-label="Aceptar invitación">
        <div className="login-copy">
          <p className="eyebrow"></p>
          <h1>MenteActiva</h1>
          <p>Confirmá tus datos e ingresá a las actividades. No necesitás crear una contraseña.</p>
        </div>
        <div className="panel login-panel">
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

          <p>
            La sesión queda abierta en este dispositivo. Si más adelante se cierra, vas a poder
            volver a entrar pidiendo un enlace a tu correo desde la pantalla de ingreso.
          </p>

          {formError && (
            <div className="error-box" role="alert">
              <AlertTriangle size={20} aria-hidden="true" /> {formError}
            </div>
          )}

          <p style={{ margin: "4px 0 0" }}>
            <MedicalDisclaimerLink />
          </p>
          <button type="button" className="primary" onClick={handleEnterWithoutPassword} disabled={submitting}>
            {submitting
              ? "Ingresando..."
              : (<><LogIn size={20} aria-hidden="true" /> Ingresar</>)}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => { setUsePassword(true); setFormError(""); }}
            disabled={submitting}
          >
            Prefiero crear una contraseña
          </button>
        </div>
      </section>
    );
  }

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

        <p style={{ margin: "4px 0 0" }}>
          <MedicalDisclaimerLink />
        </p>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting
            ? "Creando acceso..."
            : (<><CheckCircle2 size={20} aria-hidden="true" /> Aceptar invitación</>)}
        </button>
        {directAvailable && (
          <button
            type="button"
            className="link-button"
            onClick={() => { setUsePassword(false); setFormError(""); }}
            disabled={submitting}
          >
            Ingresar sin contraseña
          </button>
        )}
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
