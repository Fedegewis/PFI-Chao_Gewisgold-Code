import { Brain, GraduationCap } from "lucide-react";
import { MedicalDisclaimerLink } from "./MedicalDisclaimer.jsx";

export function Footer() {
  return (
    <footer className="app-footer" aria-label="Créditos del proyecto">
      <div className="footer-brand">
        <span className="footer-icon" aria-hidden="true"><Brain size={22} /></span>
        <div>
          <strong>MenteActiva</strong>
          <small>Entrenamiento cognitivo para adultos mayores</small>
        </div>
      </div>
      <div className="footer-meta" aria-label="Datos académicos">
        <div>
          <span className="footer-label"><GraduationCap size={14} aria-hidden="true" /> Tesis de</span>
          <p>Federico Gewisgold, Florencia Chao</p>
        </div>
        <div>
          <span className="footer-label">Universidad</span>
          <p>UADE · Ingeniería en Informática </p>
        </div>
        <div>
          <span className="footer-label">Tutor</span>
          <p>Pablo Luis Esteban Sabatino</p>
        </div>
      </div>
      <div className="footer-legal">
        <p>&copy; 2026 MenteActiva &middot; v1.0</p>
        <p>Herramienta de acompañamiento en entrenamiento cognitivo</p>
        <MedicalDisclaimerLink />
      </div>
    </footer>
  );
}
