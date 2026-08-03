import { Flower2, Leaf, Sprout } from "lucide-react";
import { cx } from "../../lib/cx.js";

export function GardenStrip({ activities, completedIds }) {
  return (
    <div className="garden-strip">
      <div><p className="eyebrow">Idea jardin</p><h2>Regamos una actividad por dia</h2></div>
      <div className="plant-row">
        {activities.map((activity, index) => {
          const done = completedIds.includes(activity.id);
          const today = !done && index === completedIds.length;
          const PlantIcon = done ? Flower2 : today ? Sprout : Leaf;
          return <div key={activity.id} className={cx("plant-pot", done && "plant-done", today && "plant-today")}><PlantIcon size={32} /><span>{done ? "Pintado" : today ? "Regar hoy" : "Pendiente"}</span></div>;
        })}
      </div>
    </div>
  );
}
