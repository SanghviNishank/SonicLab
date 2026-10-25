import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

export function Skeleton({ h = 120 }: { h?: number }) { return <div className="skeleton" style={{ height: h }} aria-hidden="true" />; }
export function PageSkeleton() { return <div className="stack" role="status" aria-label="Loading"><Skeleton h={40} /><Skeleton h={260} /><Skeleton h={120} /></div>; }

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return <div className="empty"><Inbox aria-hidden="true" /><h3>{title}</h3>{body && <p className="muted">{body}</p>}{action}</div>;
}

export function ErrorPanel({ message, onRetry, hint }: { message: string; onRetry?: () => void; hint?: string }) {
  return <div className="banner" role="alert"><div className="row"><AlertTriangle aria-hidden="true" size={18} /><b>Something went wrong</b></div>
    <p>{message}</p>{hint && <p className="muted">{hint}</p>}{onRetry && <button className="btn ghost" onClick={onRetry}>Try again</button>}</div>;
}

/** Indeterminate on purpose: the backend does not report percentage progress, so none is invented. */
export function ProcessingStatus({ label, progress }: { label: string; progress?: number }) {
  return <div role="status" aria-live="polite"><div className="row"><Loader2 className="spin" size={16} aria-hidden="true" /><span>{label}</span>{progress != null && <span className="mono muted">{progress}%</span>}</div>
    <div className={"progress" + (progress == null ? " indeterminate" : "")}><i style={progress != null ? { width: `${progress}%` } : undefined} /></div></div>;
}

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }: { open: boolean; title: string; body: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className="confirm" onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby="cd-title">
    <h3 id="cd-title">{title}</h3><p>{body}</p>
    <div className="actions"><button className="btn ghost" onClick={onCancel}>Cancel</button><button className={"btn" + (danger ? " danger" : "")} onClick={onConfirm}>{confirmLabel}</button></div></dialog>;
}

export function Metric({ value, label }: { value: ReactNode; label: string }) { return <div className="tile"><b>{value}</b><span>{label}</span></div>; }
