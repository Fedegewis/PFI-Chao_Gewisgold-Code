import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { cx } from "../../lib/cx.js";

export function GardenStrip({ activities, completedIds }) {
  const doneCount = completedIds.length;

  return (
    <div className="garden-strip" role="group" aria-label="Progreso del día">
      <div><p className="eyebrow">Progreso</p><h2>Una actividad por día</h2></div>
      <div className="plant-row">
        {activities.map((_activity, index) => {
          const done = index < doneCount;
          const next = index === doneCount;
          const StepIcon = done ? CheckCircle2 : next ? CircleDot : Circle;
          return <div key={index} className={cx("plant-pot", done && "plant-done", next && "plant-today")}><StepIcon size={32} aria-hidden="true" /><span>{done ? "Completada" : next ? "Hoy" : "Pendiente"}</span></div>;
        })}
      </div>
    </div>
  );
}
