import { Heart } from "lucide-react";
import { MOOD_OPTIONS } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";

export function MoodPanel({ patient, onUpdatePatient }) {
  function chooseMood(option) {
    onUpdatePatient(patient.id, {
      mood: option.id,
      note: option.note,
      risk: option.id === "cansancio" ? "Medio" : "Bajo"
    });
  }

  return (
    <div className="panel">
      <h3 id="mood-heading">Como te sentis hoy?</h3>
      <div className="mood-row" role="group" aria-labelledby="mood-heading">
        {MOOD_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={cx("mood-button", patient.mood === option.id && "mood-selected")}
            onClick={() => chooseMood(option)}
            aria-pressed={patient.mood === option.id}
          >
            <Heart size={24} aria-hidden="true" />
            <div>
              <strong>{option.label}</strong>
              <span>{option.note}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
