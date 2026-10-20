import { ArrowLeft, Brain, Stethoscope, UserRound } from "lucide-react";
import { useState } from "react";
import { SCREEN_NAMES } from "../../constants/appConfig.js";

const ROLE_LABELS = {
  patient: { label: "Paciente", Icon: UserRound },
  professional: { label: "Psicólogo", Icon: Stethoscope },
};

export function GlobalHeader({ screen, role, onLogout, onNavigate }) {
  const [switchTarget, setSwitchTarget] = useState(null);

  const isAuthScreen = screen !== SCREEN_NAMES.login && screen !== SCREEN_NAMES.invite;
  const currentHome = role === "professional" ? SCREEN_NAMES.professional : SCREEN_NAMES.patient;
  const otherRole = role === "professional" ? "patient" : "professional";
  const CurrentIcon = ROLE_LABELS[role]?.Icon ?? UserRound;
  const OtherIcon = ROLE_LABELS[otherRole]?.Icon ?? UserRound;

  function requestRoleSwitch() {
    setSwitchTarget(otherRole);
  }

  function cancelSwitch() {
    setSwitchTarget(null);
  }

  function confirmSwitch() {
    setSwitchTarget(null);
    onLogout();
  }

  return (
    <header className="topbar">
      <button
        className="brand"
        type="button"
        aria-label="Ir a inicio"
        onClick={() => onNavigate(isAuthScreen ? currentHome : SCREEN_NAMES.login)}
      >
        <span><Brain size={28} aria-hidden="true" /></span>
        <div><strong>MenteActiva </strong><small></small></div>
      </button>
      {isAuthScreen && (
        <nav aria-label="Navegación principal">
          <button
            type="button"
            className={screen === currentHome ? "active" : ""}
            aria-current={screen === currentHome ? "page" : undefined}
            onClick={() => onNavigate(currentHome)}
          >
            <CurrentIcon size={18} aria-hidden="true" /> {ROLE_LABELS[role]?.label ?? "Inicio"}
          </button>
          <button
            type="button"
            onClick={requestRoleSwitch}
            aria-label={`Cambiar a cuenta de ${ROLE_LABELS[otherRole]?.label ?? otherRole}`}
          >
            <OtherIcon size={18} aria-hidden="true" /> {ROLE_LABELS[otherRole]?.label ?? otherRole}
          </button>
          <button type="button" onClick={onLogout}><ArrowLeft size={18} aria-hidden="true" /> Salir</button>
        </nav>
      )}
      {switchTarget && (
        <div
          className="ai-modal-backdrop"
          onClick={cancelSwitch}
          data-testid="role-switch-backdrop"
        >
          <div
            className="ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-switch-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ai-modal-header">
              <div>
                <p className="eyebrow">Cambiar de cuenta</p>
                <h3 id="role-switch-title">
                  Ingresar como {ROLE_LABELS[switchTarget]?.label ?? switchTarget}
                </h3>
              </div>
            </div>
            <div className="ai-modal-body">
              <p>
                Para acceder al panel de {ROLE_LABELS[switchTarget]?.label ?? switchTarget} necesitás
                iniciar sesión con una cuenta de ese rol. Vamos a cerrar tu sesión actual y volver al login.
              </p>
              <div className="modal-actions">
                <button type="button" onClick={cancelSwitch}>Cancelar</button>
                <button type="button" className="primary" onClick={confirmSwitch}>
                  Cerrar sesión e ir al login
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
