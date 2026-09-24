import { ArrowLeft, Brain, Stethoscope, UserRound } from "lucide-react";
import { SCREEN_NAMES } from "../../constants/appConfig.js";

export function GlobalHeader({ screen, role, onLogout, onNavigate }) {
  return (
    <header className="topbar">
      <button className="brand" type="button" aria-label="Ir a inicio" onClick={() => onNavigate(screen === SCREEN_NAMES.login ? SCREEN_NAMES.login : role)}>
        <span><Brain size={28} aria-hidden="true" /></span>
        <div><strong>MenteActiva </strong><small></small></div>
      </button>
      {screen !== SCREEN_NAMES.login && screen !== SCREEN_NAMES.invite && (
        <nav aria-label="Navegación principal">
          <button type="button" className={screen === SCREEN_NAMES.patient ? "active" : ""} aria-current={screen === SCREEN_NAMES.patient ? "page" : undefined} onClick={() => onNavigate(SCREEN_NAMES.patient)}><UserRound size={18} aria-hidden="true" /> Paciente</button>
          {role === SCREEN_NAMES.professional && <button type="button" className={screen === SCREEN_NAMES.professional ? "active" : ""} aria-current={screen === SCREEN_NAMES.professional ? "page" : undefined} onClick={() => onNavigate(SCREEN_NAMES.professional)}><Stethoscope size={18} aria-hidden="true" /> Psicólogo</button>}
          <button type="button" onClick={onLogout}><ArrowLeft size={18} aria-hidden="true" /> Salir</button>
        </nav>
      )}
    </header>
  );
}
