import { cx } from "../../lib/cx.js";

const RISK_TONE = {
  Alto: "risk-chip--high",
  Medio: "risk-chip--mid",
  Bajo: "risk-chip--low"
};

export function PatientCard({ patient, selected, onSelect, isBackend = false }) {
  const risk = patient.risk || "Bajo";
  const ariaLabel = isBackend
    ? `${patient.name}${patient.age ? `, ${patient.age} años` : ""}. Datos reales`
    : `${patient.name}, ${patient.age} años. Riesgo ${risk}. ${patient.status}`;
  return (
    <button
      type="button"
      className={cx("patient-card", selected && "patient-card--selected")}
      onClick={() => onSelect(patient)}
      aria-current={selected ? "true" : undefined}
      aria-label={ariaLabel}
    >
      <div className="patient-card-head">
        <div className="patient-card-avatar" aria-hidden="true">{patient.name[0]}</div>
        {!isBackend && (
          <span className={cx("risk-chip", RISK_TONE[risk] ?? "risk-chip--low")}>{risk}</span>
        )}
      </div>
      <div className="patient-card-body">
        <strong>{patient.name}</strong>
        <span>{patient.age ? `${patient.age} años` : ""}</span>
        {!isBackend && <small>{patient.status}</small>}
      </div>
      {!isBackend && (
        <div className="patient-card-foot">
          <span className="patient-card-metric">
            <small>Precisión</small>
            <em>{patient.score ?? 0}%</em>
          </span>
          <span className="patient-card-metric patient-card-metric--right">
            <small>Tiempo</small>
            <em>{patient.responseTime && patient.responseTime !== "-" ? patient.responseTime : "—"}</em>
          </span>
        </div>
      )}
    </button>
  );
}
