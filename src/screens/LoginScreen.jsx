import { AlertTriangle, ChevronRight, ShieldCheck, Sparkles, Stethoscope, UserRound } from "lucide-react";
import { useState } from "react";
import { LOGIN_CREDENTIALS, MOTIVATION_MESSAGES } from "../constants/appConfig.js";

export function LoginScreen({ loginError, onLogin }) {
  const [mode, setMode] = useState("patient");
  const [email, setEmail] = useState(LOGIN_CREDENTIALS.patient.email);
  const [password, setPassword] = useState(LOGIN_CREDENTIALS.patient.password);
  const emailId = "login-email";
  const passwordId = "login-password";

  function switchMode(nextMode) {
    setMode(nextMode);
    setEmail(LOGIN_CREDENTIALS[nextMode].email);
    setPassword(LOGIN_CREDENTIALS[nextMode].password);
  }

  return (
    <section className="login-layout">
      <div className="login-copy">
        <p className="eyebrow">Ambiente 2</p>
        <h1>Jardin Cognitivo</h1>
        <p>El jardin se alimenta y crece segun los desafios completados. El paciente ve juegos cotidianos; el psicologo configura preguntas, limites y seguimiento.</p>
        <div className="motivation-banner"><Sparkles size={24} /> Bienvenida IA: {MOTIVATION_MESSAGES[0]}</div>
      </div>
      <div className="panel login-panel">
        <div className="login-tabs">
          <button className={mode === "patient" ? "tab-active" : ""} onClick={() => switchMode("patient")}><UserRound size={20} /> Paciente</button>
          <button className={mode === "professional" ? "tab-active" : ""} onClick={() => switchMode("professional")}><Stethoscope size={20} /> Psicologo</button>
        </div>
        <div className="login-title"><ShieldCheck size={34} /><div><h2>Inicio de sesion</h2><p>Usa las credenciales demo del README.</p></div></div>
        <label htmlFor={emailId}>Email</label>
        <input id={emailId} value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor={passwordId}>Clave</label>
        <input id={passwordId} value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        {loginError && <div className="error-box"><AlertTriangle size={20} /> {loginError}</div>}
        <button className="primary" onClick={() => onLogin(mode, email, password)}>Entrar como {mode === "patient" ? "paciente" : "psicologo"} <ChevronRight size={22} /></button>
      </div>
    </section>
  );
}
