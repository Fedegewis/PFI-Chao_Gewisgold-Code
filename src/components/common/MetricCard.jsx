export function MetricCard({ icon: Icon, label, value, detail }) {
  return <article className="panel metric-card"><Icon className="theme-icon" size={28} /><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}
