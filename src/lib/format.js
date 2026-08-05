export function formatLatency(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}
