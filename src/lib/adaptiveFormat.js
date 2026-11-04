// Presentación para el profesional de la decisión adaptativa de dificultad
// persistida por el backend (session_sections.adaptive_decision).
// Lenguaje descriptivo y operativo: los umbrales son reglas de la aplicación,
// no criterios clínicos.

const LEVEL_LABELS = Object.freeze({
  1: "Nivel 1 (más accesible)",
  2: "Nivel 2 (intermedio)",
  3: "Nivel 3 (más exigente)",
});

const DIFFICULTY_LABELS = Object.freeze({ 1: "Fácil", 2: "Media", 3: "Difícil" });

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 1000) / 10;
  return `${String(rounded).replace(".", ",")} %`;
}

export function formatAdaptiveLevel(level) {
  return LEVEL_LABELS[level] || "—";
}

function formatChange(decision, level) {
  const previous = decision?.previous_level;
  switch (decision?.change) {
    case "initial": return "Nivel inicial";
    case "up": return `Subió (antes: nivel ${previous})`;
    case "down": return `Bajó (antes: nivel ${previous})`;
    case "hold": return `Se mantuvo en nivel ${level}`;
    default: return "—";
  }
}

function formatReason(decision) {
  const t = decision?.thresholds || {};
  const up = Number.isFinite(t.up) ? pct(t.up) : "—";
  const down = Number.isFinite(t.down) ? pct(t.down) : "—";
  switch (decision?.rule) {
    case "initial_level":
      return "Primera sesión de esta actividad con ajuste de dificultad: se usa el nivel inicial.";
    case "insufficient_evidence":
      return `Todavía no hay evidencia suficiente en este nivel para decidir un cambio (se requieren al menos ${t.min_sessions ?? "—"} sesiones completadas y ${t.min_scored_responses ?? "—"} respuestas).`;
    case "high_accuracy_sustained":
      return `La precisión agrupada de las sesiones recientes en este nivel alcanzó el umbral de subida (${up} o más).`;
    case "low_accuracy_sustained":
      return `La precisión agrupada de las sesiones recientes en este nivel quedó en el umbral de bajada o por debajo (${down} o menos).`;
    case "intermediate_accuracy":
      return `La precisión agrupada quedó entre el umbral de bajada (${down}) y el de subida (${up}).`;
    case "max_level_reached":
      return "Se alcanzó el umbral de subida, pero la actividad ya está en el nivel máximo.";
    case "min_level_reached":
      return "Se alcanzó el umbral de bajada, pero la actividad ya está en el nivel mínimo.";
    default:
      return "—";
  }
}

function formatEvidence(evidence) {
  if (!evidence || !evidence.sessions_count) return "Sin sesiones completadas previas en este nivel.";
  const sessions = `${evidence.sessions_count} ${evidence.sessions_count === 1 ? "sesión" : "sesiones"}`;
  return `${sessions} · ${evidence.correct_count} de ${evidence.scored_count} respuestas correctas (${pct(evidence.accuracy)})`;
}

function formatMix(mix) {
  if (!mix || typeof mix !== "object") return null;
  const parts = [1, 2, 3]
    .filter((d) => Number(mix[d]) > 0)
    .map((d) => `${DIFFICULTY_LABELS[d]}: ${mix[d]}`);
  if (Number(mix.unknown) > 0) parts.push(`Sin dificultad: ${mix.unknown}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function sameMix(a, b) {
  return [1, 2, 3].every((d) => Number(a?.[d] || 0) === Number(b?.[d] || 0)) && !(Number(a?.unknown) > 0);
}

/**
 * @param {{level:number, version:string, decision:object|null}|null} adaptive
 * @returns {null | {level, change, reason, evidence, mix, target, usedFallback}}
 */
export function formatAdaptiveSummary(adaptive) {
  if (!adaptive || !LEVEL_LABELS[adaptive.level]) return null;
  const decision = adaptive.decision || {};
  const selection = decision.selection || {};
  const mix = formatMix(selection.actual_mix);
  const target = formatMix(selection.targets);
  const usedFallback = Boolean(selection.actual_mix && selection.targets && !sameMix(selection.actual_mix, selection.targets));
  return {
    level: formatAdaptiveLevel(adaptive.level),
    change: formatChange(decision, adaptive.level),
    reason: formatReason(decision),
    // Registro incompleto (nivel sin traza): no se afirma que no hubo evidencia.
    evidence: adaptive.decision ? formatEvidence(decision.evidence) : "—",
    mix,
    target,
    usedFallback,
  };
}
