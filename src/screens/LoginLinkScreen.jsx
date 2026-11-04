import { AlertTriangle, LogIn, MailCheck, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { consumePatientLoginLink } from "../services/authService.js";

// F2 — destino del enlace de acceso enviado por correo (#/enlace/<token>).
//
// El token ya fue quitado de la URL (navigationService) y llega sólo por
// props, desde memoria. NO se canjea automáticamente al cargar: el paciente
// toca "Ingresar". Así, los programas que revisan enlaces en los correos
// (antivirus, vista previa) no consumen el enlace antes que la persona.
//
// Si el enlace se abre en otro navegador o dispositivo, funciona igual: la
// sesión queda en el navegador donde se tocó "Ingresar".

export function LoginLinkScreen({ token, onSuccess, onGoToLogin }) {
  const [state, setState] = useState(token ? "ready" : "invalid");
  const headingRef = useRef(null);

  // Foco en el título al llegar y al cambiar a una pantalla distinta
  // (vencido / no disponible), para que el lector de pantalla la anuncie.
  const screenKind = state === "invalid" || state === "unavailable" ? state : "main";
  useEffect(() => {
    headingRef.current?.focus();
  }, [screenKind]);

  async function handleEnter() {
    if (!token || state === "loading") return;
    setState("loading");
    try {
      const data = await consumePatientLoginLink(token);
      onSuccess?.(data);
    } catch (err) {
      if (err?.status === 410 || err?.code === "invalid_link") setState("invalid");
      else if (err?.status === 429) setState("rate_limited");
      else if (err?.status === 503) setState("unavailable");
      else setState("network");
    }
  }

  if (state === "invalid") {
    return (
      <LinkMessage
        headingRef={headingRef}
        title="Este enlace ya no sirve"
        icon={<AlertTriangle size={32} aria-hidden="true" />}
      >
        <p>Los enlaces vencen a los 30 minutos y se pueden usar una sola vez.</p>
        <p>Podés pedir un enlace nuevo ahora.</p>
        <button type="button" className="primary" onClick={() => onGoToLogin?.({ passwordless: true })}>
          <MailCheck size={22} aria-hidden="true" /> Pedir un enlace nuevo
        </button>
        <button type="button" className="link-button passwordless-back" onClick={() => onGoToLogin?.({ passwordless: false })}>
          Ingresar con mi contraseña
        </button>
      </LinkMessage>
    );
  }

  if (state === "unavailable") {
    return (
      <LinkMessage headingRef={headingRef} title="El ingreso con enlace no está disponible" icon={<AlertTriangle size={32} aria-hidden="true" />}>
        <p>En este momento no se puede ingresar con enlace. Si tenés contraseña, podés ingresar con ella.</p>
        <button type="button" className="primary" onClick={() => onGoToLogin?.({ passwordless: false })}>
          Ir al inicio de sesión
        </button>
      </LinkMessage>
    );
  }

  return (
    <section className="login-layout" aria-label="Ingresar con enlace">
      <div className="login-copy">
        <h1>MenteActiva</h1>
        <p>Abriste el enlace que te enviamos por correo.</p>
      </div>
      <div className="panel login-panel">
        <div className="login-title">
          <LogIn size={34} aria-hidden="true" />
          <div>
            <h2 ref={headingRef} tabIndex={-1}>Ingresar a MenteActiva</h2>
            <p>Tocá el botón para entrar. El enlace sirve una sola vez.</p>
          </div>
        </div>

        <div aria-live="polite">
          {state === "loading" && <p className="ai-hint" role="status">Ingresando…</p>}
        </div>

        {state === "network" && (
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> No pudimos conectar. Revisá tu conexión e intentá de nuevo.
          </div>
        )}
        {state === "rate_limited" && (
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> Hubo muchos intentos seguidos. Esperá unos minutos y volvé a intentar.
          </div>
        )}

        <button type="button" className="primary" onClick={handleEnter} disabled={state === "loading"}>
          {state === "loading"
            ? "Ingresando…"
            : state === "ready"
              ? <><LogIn size={22} aria-hidden="true" /> Ingresar</>
              : <><RefreshCw size={22} aria-hidden="true" /> Intentar de nuevo</>}
        </button>
        <p className="training-hint">Esta sesión queda abierta en este dispositivo hasta 30 días o hasta que toques “Salir”.</p>
      </div>
    </section>
  );
}

function LinkMessage({ title, icon, headingRef, children }) {
  return (
    <section className="login-layout" aria-label={title}>
      <div className="login-copy">
        <h1>MenteActiva</h1>
      </div>
      <div className="panel login-panel">
        <div className="login-title">
          {icon}
          <div>
            <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
