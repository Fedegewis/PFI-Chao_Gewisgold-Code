import { AlertTriangle, ChevronRight, ShieldCheck, Stethoscope, UserPlus, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MOTIVATION_MESSAGES } from "../constants/appConfig.js";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function LoginScreen({ loginError, onLogin, onRegister, onGoogleLogin }) {
  const loginMotivation = useMemo(() => {
    const day = new Date().getDay();
    const offset = Math.floor(MOTIVATION_MESSAGES.length / 2);
    return MOTIVATION_MESSAGES[(day + offset) % MOTIVATION_MESSAGES.length];
  }, []);
  const [mode, setMode] = useState("patient");
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const emailId = "login-email";
  const passwordId = "login-password";
  const nameId = "login-name";
  const patientTabRef = useRef(null);
  const professionalTabRef = useRef(null);

  const googleBtnRef = useRef(null);
  const [googleReady, setGoogleReady] = useState(false);

  // Ref al último onGoogleLogin: mantiene el callback estable sin
  // reinicializar Google Identity Services en cada render.
  const onGoogleLoginRef = useRef(onGoogleLogin);
  useEffect(() => {
    onGoogleLoginRef.current = onGoogleLogin;
  }, [onGoogleLogin]);

  const handleGoogleResponse = useCallback((response) => {
    // [DEBUG-TEMP google-auth] instrumentación para diagnosticar "Failed to fetch" en primer intento.
    // Retirar cuando se cierre el bug.
    if (typeof window !== "undefined") {
      window.__gAuthAttempt = (window.__gAuthAttempt || 0) + 1;
      console.debug(`[google-auth][attempt-${window.__gAuthAttempt}] callback recibido; hasCredential=${!!response?.credential} t=${Date.now()}`);
    }
    if (response.credential) {
      onGoogleLoginRef.current?.(response.credential);
    }
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    function initGoogle() {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse,
      });
      setGoogleReady(true);
    }

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", initGoogle);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
  }, [handleGoogleResponse]);

  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || mode !== "professional" || !googleBtnRef.current) return;
    googleBtnRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      locale: "es",
      width: googleBtnRef.current.offsetWidth || 300,
    });
  }, [googleReady, mode]);

  const visibleError = dirty ? "" : loginError;

  function switchMode(nextMode) {
    setMode(nextMode);
    setIsRegister(false);
    setName("");
    setEmail("");
    setPassword("");
    setDirty(false);
  }

  function handleTabKeyDown(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const nextMode = mode === "patient" ? "professional" : "patient";
      switchMode(nextMode);
      const nextRef = nextMode === "patient" ? patientTabRef : professionalTabRef;
      nextRef.current?.focus();
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setDirty(false);
    setLoading(true);
    try {
      if (mode === "professional" && isRegister) {
        await onRegister(name, email, password);
      } else {
        await onLogin(mode, email, password);
      }
    } finally {
      setLoading(false);
    }
  }

  const isProfessional = mode === "professional";

  return (
    <section className="login-layout" aria-label="Inicio de sesión">
      <div className="login-copy">
        <p className="eyebrow"></p>
        <h1>MenteActiva</h1>
        <p>Actividades cognitivas guiadas para el paciente. Configuración, seguimiento y límites para el profesional.</p>
        <div className="motivation-banner">{loginMotivation}</div>
      </div>
      <form className="panel login-panel" onSubmit={handleSubmit} noValidate>
        <div className="login-tabs" role="tablist" aria-label="Tipo de usuario">
          <button
            ref={patientTabRef}
            type="button"
            role="tab"
            id="tab-patient"
            aria-selected={mode === "patient"}
            aria-controls="tabpanel-login"
            tabIndex={mode === "patient" ? 0 : -1}
            className={mode === "patient" ? "tab-active" : ""}
            onClick={() => switchMode("patient")}
            onKeyDown={handleTabKeyDown}
          >
            <UserRound size={20} aria-hidden="true" /> Paciente
          </button>
          <button
            ref={professionalTabRef}
            type="button"
            role="tab"
            id="tab-professional"
            aria-selected={mode === "professional"}
            aria-controls="tabpanel-login"
            tabIndex={mode === "professional" ? 0 : -1}
            className={mode === "professional" ? "tab-active" : ""}
            onClick={() => switchMode("professional")}
            onKeyDown={handleTabKeyDown}
          >
            <Stethoscope size={20} aria-hidden="true" /> Psicólogo
          </button>
        </div>
        <div id="tabpanel-login" role="tabpanel" aria-labelledby={mode === "patient" ? "tab-patient" : "tab-professional"}>
          <div className="login-title">
            <ShieldCheck size={34} aria-hidden="true" />
            <div>
              <h2>{isProfessional && isRegister ? "Crear cuenta" : "Inicio de sesión"}</h2>
              <p>{isProfessional
                ? (isRegister ? "Completá tus datos para registrarte." : "Ingresá con tu cuenta de profesional.")
                : "Ingresá con las credenciales que recibiste en tu invitación."}</p>
            </div>
          </div>
          {isProfessional && isRegister && (
            <>
              <label htmlFor={nameId}>Nombre completo</label>
              <input
                id={nameId}
                type="text"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
              />
            </>
          )}
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setDirty(true); }}
          />
          <label htmlFor={passwordId}>Clave</label>
          <input
            id={passwordId}
            type="password"
            name="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setDirty(true); }}
          />
        </div>
        {visibleError && (
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> {visibleError}
          </div>
        )}
        <button type="submit" className="primary" disabled={loading}>
          {loading ? "Cargando..." : (
            isProfessional && isRegister
              ? <><UserPlus size={22} aria-hidden="true" /> Registrarse</>
              : <>Entrar como {mode === "patient" ? "paciente" : "psicólogo"} <ChevronRight size={22} aria-hidden="true" /></>
          )}
        </button>
        {isProfessional && (
          <button
            type="button"
            className="link-button"
            onClick={() => { setIsRegister(!isRegister); setDirty(true); }}
          >
            {isRegister ? "Ya tengo cuenta, iniciar sesión" : "No tengo cuenta, registrarme"}
          </button>
        )}
        {isProfessional && GOOGLE_CLIENT_ID && (
          <>
            <div className="login-divider" aria-hidden="true"><span>o</span></div>
            <div ref={googleBtnRef} className="google-btn-container" />
          </>
        )}
      </form>
    </section>
  );
}
