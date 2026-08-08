import { MOOD_OPTIONS } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";

function MoodFace({ mood }) {
  const common = {
    width: 40,
    height: 40,
    viewBox: "0 0 40 40",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };
  const face = <circle cx="20" cy="20" r="16" fill="rgba(255,255,255,0.7)" />;
  const eyes = (
    <>
      <circle cx="14.5" cy="17" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="25.5" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </>
  );

  if (mood === "alegria") {
    return (
      <svg {...common}>
        {face}
        {eyes}
        <path d="M13 24c2 3 5 4 7 4s5-1 7-4" />
      </svg>
    );
  }
  if (mood === "bien") {
    return (
      <svg {...common}>
        {face}
        {eyes}
        <path d="M13.5 24c2 2 4.5 2.6 6.5 2.6s4.5-.6 6.5-2.6" />
      </svg>
    );
  }
  if (mood === "calma") {
    return (
      <svg {...common}>
        {face}
        <path d="M12.5 17.5c1-1 3-1 4 0" />
        <path d="M23.5 17.5c1-1 3-1 4 0" />
        <path d="M14 25h12" />
      </svg>
    );
  }
  if (mood === "cansancio") {
    return (
      <svg {...common}>
        {face}
        <path d="M12.5 18c1.2-.6 2.8-.6 4 0" />
        <path d="M23.5 18c1.2-.6 2.8-.6 4 0" />
        <path d="M14 26c2-1.5 4-2 6-2s4 .5 6 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      {face}
      {eyes}
      <path d="M13 27c2-3 5-4 7-4s5 1 7 4" />
    </svg>
  );
}

export function MoodPanel({ patient, onUpdatePatient }) {
  function chooseMood(option) {
    onUpdatePatient(patient.id, {
      mood: option.id,
      note: option.note,
      risk: option.risk ?? "Bajo"
    });
  }

  return (
    <div className="panel">
      <h3 id="mood-heading">¿Cómo te sentís hoy?</h3>
      <div className="mood-grid" role="group" aria-labelledby="mood-heading">
        {MOOD_OPTIONS.map((option) => {
          const selected = patient.mood === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={cx("mood-chip", selected && "mood-chip--selected")}
              onClick={() => chooseMood(option)}
              aria-pressed={selected}
              aria-label={`${option.label}. ${option.note}`}
            >
              <span className="mood-face" aria-hidden="true">
                <MoodFace mood={option.id} />
              </span>
              <strong>{option.label}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
