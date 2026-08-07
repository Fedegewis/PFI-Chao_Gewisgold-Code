export function MetricCard({ icon: Icon, label, value, detail }) {
  return <article className="panel metric-card" aria-label={`${label}: ${value}`}><Icon className="theme-icon" size={28} aria-hidden="true" /><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}
