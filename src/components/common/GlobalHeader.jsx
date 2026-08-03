import { ArrowLeft, Leaf, Stethoscope, UserRound } from "lucide-react";
import { SCREEN_NAMES } from "../../constants/appConfig.js";

export function GlobalHeader({ screen, role, onLogout, onNavigate }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate(screen === SCREEN_NAMES.login ? SCREEN_NAMES.login : role)}>
        <span><Leaf size={28} /></span>
        <div><strong>MenteActiva Jardin</strong><small>Ambiente 2 - Jardin Cognitivo</small></div>
      </button>
      {screen !== SCREEN_NAMES.login && (
        <nav>
          <button className={screen === SCREEN_NAMES.patient ? "active" : ""} onClick={() => onNavigate(SCREEN_NAMES.patient)}><UserRound size={18} /> Paciente</button>
          {role === SCREEN_NAMES.professional && <button className={screen === SCREEN_NAMES.professional ? "active" : ""} onClick={() => onNavigate(SCREEN_NAMES.professional)}><Stethoscope size={18} /> Psicologo</button>}
          <button onClick={onLogout}><ArrowLeft size={18} /> Salir</button>
        </nav>
      )}
    </header>
  );
}
