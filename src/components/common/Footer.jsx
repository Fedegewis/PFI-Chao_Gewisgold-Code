import { GraduationCap, Heart, Leaf } from "lucide-react";

export function Footer() {
  return (
    <footer className="app-footer" aria-label="Créditos del proyecto">
      <div className="footer-brand">
        <span className="footer-icon" aria-hidden="true"><Leaf size={22} /></span>
        <div>
          <strong>Jardín Cognitivo</strong>
          <small>Rehabilitación cognitiva para adultos mayores</small>
        </div>
      </div>
      <div className="footer-meta" aria-label="Datos académicos">
        <div>
          <span className="footer-label"><GraduationCap size={14} aria-hidden="true" /> Tesis de</span>
          <p>[Tu Nombre]</p>
        </div>
        <div>
          <span className="footer-label">Universidad</span>
          <p>[Universidad] · [Carrera]</p>
        </div>
        <div>
          <span className="footer-label">Tutor</span>
          <p>[Nombre del tutor]</p>
        </div>
      </div>
      <div className="footer-legal">
        <p>&copy; 2026 Jardín Cognitivo &middot; v1.0</p>
        <p className="footer-heart">Hecho con <Heart size={13} aria-hidden="true" /> para acompañar procesos cognitivos</p>
      </div>
    </footer>
  );
}
