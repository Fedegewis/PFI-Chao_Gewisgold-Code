import { AlertTriangle, Info, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MEDICAL_DISCLAIMER_FULL_TEXT,
  MEDICAL_DISCLAIMER_LINK_LABEL,
  MEDICAL_DISCLAIMER_NOTE,
  MEDICAL_DISCLAIMER_SHORT,
  MEDICAL_DISCLAIMER_TITLE,
} from "../../constants/legal.js";

// Selector de elementos focusables para el focus trap del modal.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal accesible con focus trap, cierre por Escape y restauración de foco al
// elemento que lo abrió. Usa las clases .ai-modal-* existentes de styles.css.
function MedicalDisclaimerModal({ open, onClose, titleId, returnFocusRef }) {
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Foco inicial al botón de cerrar (elemento interactivo garantizado).
    closeBtnRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restauración del foco al disparador original.
      if (returnFocusRef?.current && typeof returnFocusRef.current.focus === "function") {
        returnFocusRef.current.focus();
      }
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;
  return (
    <div
      className="ai-modal-backdrop"
      onClick={() => onClose()}
      data-testid="disclaimer-modal-backdrop"
    >
      <div
        ref={panelRef}
        className="ai-modal medical-disclaimer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-modal-header">
          <div>
            <p className="eyebrow">Aviso legal</p>
            <h3 id={titleId}>{MEDICAL_DISCLAIMER_TITLE}</h3>
          </div>
          <button
            type="button"
            ref={closeBtnRef}
            className="ai-modal-close"
            onClick={() => onClose()}
            aria-label="Cerrar aviso legal"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="ai-modal-body">
          <p className="medical-disclaimer-full-text">{MEDICAL_DISCLAIMER_FULL_TEXT}</p>
        </div>
      </div>
    </div>
  );
}

// Hook interno para gestionar apertura/cierre del modal y el foco de retorno.
function useDisclaimerModal() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const openModal = useCallback(() => setOpen(true), []);
  return { open, openModal, close, triggerRef };
}

// Banner compacto (Capa B). Para pantallas principales (PatientScreen,
// BackendPatientDetail). Incluye enlace "Ver aviso legal completo" que abre el modal.
export function MedicalDisclaimerBanner({ className = "" }) {
  const { open, openModal, close, triggerRef } = useDisclaimerModal();
  const titleId = useId();
  const classes = ["medical-disclaimer", "medical-disclaimer--banner", className]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <aside className={classes} role="note" aria-label="Aviso legal y limitaciones de uso">
        <AlertTriangle size={18} aria-hidden="true" />
        <p className="medical-disclaimer-text">
          {MEDICAL_DISCLAIMER_SHORT}{" "}
          <button
            type="button"
            ref={triggerRef}
            className="link-button medical-disclaimer-trigger"
            onClick={openModal}
          >
            {MEDICAL_DISCLAIMER_LINK_LABEL}
          </button>
        </p>
      </aside>
      <MedicalDisclaimerModal
        open={open}
        onClose={close}
        titleId={titleId}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

// Nota contextual (Capa C). Para debajo de métricas individuales (PerformancePanel,
// AnalysisAsistidoPanel) donde el riesgo de confusión con un indicador clínico
// puntual existe pero NO corresponde repetir el banner completo.
export function MedicalDisclaimerNote({ className = "" }) {
  const classes = ["medical-disclaimer-note", className].filter(Boolean).join(" ");
  return (
    <p className={classes} role="note">
      <Info size={14} aria-hidden="true" /> {MEDICAL_DISCLAIMER_NOTE}
    </p>
  );
}

// Enlace discreto (Footer, LoginScreen, InviteAcceptScreen).
export function MedicalDisclaimerLink({ className = "", label }) {
  const { open, openModal, close, triggerRef } = useDisclaimerModal();
  const titleId = useId();
  const classes = ["link-button", "medical-disclaimer-link", className]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={classes}
        onClick={openModal}
      >
        {label || MEDICAL_DISCLAIMER_LINK_LABEL}
      </button>
      <MedicalDisclaimerModal
        open={open}
        onClose={close}
        titleId={titleId}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
