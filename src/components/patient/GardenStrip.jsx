import { Flower2, Leaf, Sprout } from "lucide-react";
import { cx } from "../../lib/cx.js";

export function GardenStrip({ activities, completedIds }) {
  return (
    <div className="garden-strip" role="group" aria-label="Progreso del jardín">
      <div><p className="eyebrow">Idea jardín</p><h2>Regamos una actividad por día</h2></div>
      <div className="plant-row">
        {activities.map((activity, index) => {
          const done = completedIds.includes(activity.id);
          const today = !done && index === completedIds.length;
          const PlantIcon = done ? Flower2 : today ? Sprout : Leaf;
          return <div key={activity.id} className={cx("plant-pot", done && "plant-done", today && "plant-today")}><PlantIcon size={32} aria-hidden="true" /><span>{done ? "Pintado" : today ? "Regar hoy" : "Pendiente"}</span></div>;
        })}
      </div>
    </div>
  );
}
