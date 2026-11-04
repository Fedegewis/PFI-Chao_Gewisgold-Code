import { AlertTriangle, ArrowLeft, Mail, MailCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { requestPatientLoginLink } from "../../services/authService.js";

// F2 — "Ingresar con un enlace a mi correo" (pantalla de ingreso del paciente).
//
// La confirmación es SIEMPRE la misma, exista o no la cuenta y esté o no
// habilitada: la pantalla no revela si un correo está registrado.
// "Enviar de nuevo" se habilita tras una espera corta para evitar pedidos
// repetidos por error (el backend además limita por correo y por IP).

const RESEND_WAIT_SECONDS = 30;

export function PasswordlessRequestPanel({ onBack }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("form"); // form | sending | sent
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);
  const sentHeadingRef = useRef(null);
  const emailInputRef = useRef(null);
  const emailId = "passwordless-email";
  const errorId = "passwordless-email-error";

  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state === "sent") sentHeadingRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Escribí tu correo electrónico completo, por ejemplo: nombre@correo.com");
      return;
    }
    setError("");
    setState("sending");
    try {
      await requestPatientLoginLink(trimmed);
      setState("sent");
      setWait(RESEND_WAIT_SECONDS);
    } catch (err) {
      setState((prev) => (prev === "sending" ? "form" : prev));
      if (err?.status === 429) setError("Hiciste varios pedidos seguidos. Esperá unos minutos y volvé a intentar.");
      else if (err?.status === 400) setError("Escribí tu correo electrónico completo, por ejemplo: nombre@correo.com");
      else if (err?.status === 503) setError("En este momento no se puede ingresar con enlace. Si tenés contraseña, podés usarla.");
      else setError("No pudimos conectar. Revisá tu conexión e intentá de nuevo.");
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send();
  }

  if (state === "sent") {
    return (
      <div className="panel login-panel" aria-label="Enlace enviado">
        <div className="login-title">
          <MailCheck size={34} aria-hidden="true" />
          <div>
            <h2 ref={sentHeadingRef} tabIndex={-1}>Revisá tu correo</h2>
            <p>Si el correo <strong>{email.trim()}</strong> corresponde a una cuenta habilitada, te enviamos un enlace para ingresar.</p>
          </div>
        </div>
        <ul className="passwordless-steps">
          <li>Abrí el correo de MenteActiva y tocá «Ingresar a MenteActiva».</li>
          <li>El enlace vence en 30 minutos y sirve una sola vez.</li>
          <li>Si no lo ves, revisá la carpeta de correo no deseado.</li>
        </ul>
        {error && (
          <div className="error-box" role="alert">
            <AlertTriangle size={20} aria-hidden="true" /> {error}
          </div>
        )}
        <button type="button" className="secondary-action passwordless-secondary" onClick={send} disabled={wait > 0}>
          {wait > 0 ? `Podés pedir otro enlace en ${wait} segundos` : "No me llegó: enviar otro enlace"}
        </button>
        <button type="button" className="link-button passwordless-back" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" /> Volver al inicio de sesión
        </button>
      </div>
    );
  }

  const sending = state === "sending";
  return (
    <form className="panel login-panel" onSubmit={handleSubmit} noValidate aria-label="Ingresar con un enlace a mi correo">
      <div className="login-title">
        <Mail size={34} aria-hidden="true" />
        <div>
          <h2>Ingresar con un enlace</h2>
          <p>Escribí tu correo y te enviamos un enlace para entrar, sin contraseña.</p>
        </div>
      </div>
      <label htmlFor={emailId}>Tu correo electrónico</label>
      <input
        ref={emailInputRef}
        id={emailId}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => { setEmail(e.target.value); setError(""); }}
      />
      {error && (
        <div className="error-box" role="alert" id={errorId}>
          <AlertTriangle size={20} aria-hidden="true" /> {error}
        </div>
      )}
      <button type="submit" className="primary" disabled={sending}>
        {sending ? "Enviando…" : <><Mail size={22} aria-hidden="true" /> Enviarme el enlace</>}
      </button>
      <div aria-live="polite" className="sr-only">{sending ? "Enviando el enlace" : ""}</div>
      <button type="button" className="link-button passwordless-back" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" /> Volver a ingresar con contraseña
      </button>
    </form>
  );
}
