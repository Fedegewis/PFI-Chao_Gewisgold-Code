import { cx } from "../../lib/cx.js";

const RISK_TONE = {
  Alto: "risk-chip--high",
  Medio: "risk-chip--mid",
  Bajo: "risk-chip--low"
};

export function PatientCard({ patient, selected, onSelect }) {
  const risk = patient.risk || "Bajo";
  return (
    <button
      type="button"
      className={cx("patient-card", selected && "patient-card--selected")}
      onClick={() => onSelect(patient)}
      aria-current={selected ? "true" : undefined}
      aria-label={`${patient.name}, ${patient.age} años. Riesgo ${risk}. ${patient.status}`}
    >
      <div className="patient-card-head">
        <div className="patient-card-avatar" aria-hidden="true">{patient.name[0]}</div>
        <span className={cx("risk-chip", RISK_TONE[risk] ?? "risk-chip--low")}>{risk}</span>
      </div>
      <div className="patient-card-body">
        <strong>{patient.name}</strong>
        <span>{patient.age} años</span>
        <small>{patient.status}</small>
      </div>
      <div className="patient-card-foot">
        <span className="patient-card-metric">
          <em>{patient.score ?? 0}%</em>
          <small>Precision</small>
        </span>
        <span className="patient-card-metric">
          <em>{patient.trend ?? "0%"}</em>
          <small>Tendencia</small>
        </span>
      </div>
    </button>
  );
}
