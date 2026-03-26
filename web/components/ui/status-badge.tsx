const STATUS_STYLES: Record<string, string> = {
  draft: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  published: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  archived: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  subscribed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  queued: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  processing: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  sent: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-200",
  staged: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  unsubscribed: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-200",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  completed_with_errors: "border-rose-400/20 bg-rose-400/10 text-rose-200"
};

export function StatusBadge({ value }: { value: string }) {
  const classes =
    STATUS_STYLES[value] || "border-slate-400/20 bg-slate-400/10 text-slate-200";
  return <span className={`status-pill ${classes}`}>{value}</span>;
}
