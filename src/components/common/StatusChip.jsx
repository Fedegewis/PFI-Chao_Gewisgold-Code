export function StatusChip({ icon: Icon, text }) {
  return <span className="status-chip"><Icon size={16} aria-hidden="true" /> {text}</span>;
}
