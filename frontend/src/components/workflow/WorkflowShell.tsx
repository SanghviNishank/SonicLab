import { type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, FileAudio, Loader2, CircleCheck, Presentation } from "lucide-react";
import { presentation } from "../../features/presentation/state";
import { STEPS, blockedReason, nextStep, prevStep, redirectFor, stepIndex, stepStatus, type ModuleId } from "../../logic/workflow.ts";
import { useSession, useSnapshot } from "../../context/Session";
import { PageSkeleton } from "../ui";
import { useInflight } from "../../hooks/useInflight";
import { formatTime } from "../../logic/format.ts";

const NAMES: Record<ModuleId, string> = { clearvoice: "ClearVoice", roadsonic: "RoadSonic" };
const LABEL: Record<string, string> = { not_started: "Not started", current: "Current", completed: "Completed", blocked: "Locked" };

/** Redirects to the furthest legal step when a URL is opened without its prerequisites (e.g. after a refresh or a pasted link). */
export function StepGuard({ module, step, children }: { module: ModuleId; step: string; children: ReactNode }) {
  const snap = useSnapshot(module), { restoring } = useSession();
  if (restoring) return <div className="page"><PageSkeleton /></div>;
  const reason = blockedReason(module, step, snap);
  if (reason) return <Navigate to={`/${module}/${redirectFor(module, step, snap)}`} replace state={{ notice: reason }} />;
  return <>{children}</>;
}

export function Stepper({ module, current }: { module: ModuleId; current: string }) {
  const snap = useSnapshot(module);
  return (
    <nav aria-label={`${NAMES[module]} steps`}><ol className="stepper">
      {STEPS[module].map((s, i) => {
        const st = stepStatus(module, s.key, current, snap), n = String(i + 1).padStart(2, "0");
        const body = <><b>{n}</b><span>{s.short}</span><small>{LABEL[st]}{s.optional && st === "not_started" ? " · optional" : ""}</small></>;
        return <li key={s.key}>{st === "blocked" ? <span className="step blocked" aria-disabled="true">{body}</span>
          : <Link to={`/${module}/${s.key}`} className={`step ${st}`} aria-current={st === "current" ? "step" : undefined}>{body}</Link>}</li>;
      })}
    </ol></nav>
  );
}

/** Current recording + live processing status. The status comes from the API client's real in-flight request count. */
export function SessionStrip({ module }: { module: ModuleId }) {
  const { cv, rs } = useSession(), up = (module === "clearvoice" ? cv : rs).upload, busy = useInflight() > 0;
  if (!up) return null;
  const m = up.metadata;
  return (
    <div className="session-strip" aria-label="Current recording">
      <span className="row"><FileAudio size={16} aria-hidden="true" /><b className="name">{up.file?.name ?? "Restored recording"}</b></span>
      <span className="mono muted">{m.sample_rate_hz} Hz · {m.channels} ch · {formatTime(m.duration_s)}</span>
      <button className="btn ghost present-btn" style={{ marginLeft: "auto" }} onClick={() => presentation.start(module)}><Presentation size={14} aria-hidden="true" /> Presentation Mode</button>
      <span className={"chip " + (busy ? "warn" : "ok")} role="status" aria-live="polite">
        {busy ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Processing…</> : <><CircleCheck size={13} aria-hidden="true" /> Idle</>}</span>
    </div>
  );
}

export default function WorkflowShell({ module, step, title, intro, children, onNext, nextLabel, nextDisabled, nextBusy, hideNext }:
  { module: ModuleId; step: string; title: string; intro?: ReactNode; children: ReactNode; onNext?: () => Promise<boolean | void> | boolean | void; nextLabel?: string; nextDisabled?: boolean; nextBusy?: boolean; hideNext?: boolean }) {
  const nav = useNavigate(), loc = useLocation(), snap = useSnapshot(module);
  const prev = prevStep(module, step), next = nextStep(module, step), idx = stepIndex(module, step), total = STEPS[module].length;
  const notice = (loc.state as any)?.notice as string | undefined;
  const nextBlocked = next ? !!blockedReason(module, next, snap) : true;
  async function go() { if (!next) return; if (onNext) { const ok = await onNext(); if (ok === false) return; } nav(`/${module}/${next}`); }
  return (
    <div className="page wf" data-module={module}>
      <div className="wf-head"><div><div className="crumbs"><Link to="/">SonicSense</Link> / <Link to={`/${module}/upload`}>{NAMES[module]}</Link> / {STEPS[module][idx]?.label}</div><h1>{title}</h1></div>
        <span className="chip mono" aria-label={`Step ${idx + 1} of ${total}`}>Step {idx + 1} of {total}</span></div>
      {module === "roadsonic" && <div className="banner caution" role="note"><b>Academic prototype.</b> Detected intervals are candidate siren events and are not certified emergency alerts.</div>}
      {notice && <div className="banner note" role="status">{notice}</div>}
      <SessionStrip module={module} />
      <Stepper module={module} current={step} />
      {intro && <p className="muted">{intro}</p>}
      {children}
      <div className="wf-bar">
        {prev ? <Link className="btn ghost" to={`/${module}/${prev}`}><ArrowLeft size={16} /> Back</Link> : <span />}
        {!hideNext && next && <button className="btn" disabled={nextDisabled || nextBusy || (!onNext && nextBlocked)} onClick={go}>{nextBusy ? "Working…" : (nextLabel ?? "Next")} <ArrowRight size={16} /></button>}
      </div>
    </div>
  );
}
