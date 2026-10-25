import { useState } from "react";
import { useNavigate } from "react-router-dom";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import ABPlayer from "../../components/audio/ABPlayer";
import Plot from "../../components/Plot";
import { chartColors } from "../../components/charts/colors";
import { ConfirmDialog, EmptyState, ErrorPanel, Metric } from "../../components/ui";
import { useMarkLoaded, useSession } from "../../context/Session";
import { postJson, url } from "../../api";

export function ReviewStep() {
  const { rs, patchRs } = useSession(), r = rs.res, nav = useNavigate(), c = chartColors(), i = rs.sel, e = i != null ? r.events[i] : null, active = r.preprocessing.active;
  useMarkLoaded("roadsonic", "review", !!e);
  const clip = (v: string) => url(`/api/v1/roadsonic/${r.job_id}/event/${i}/audio?pre=2&post=2&version=${v}`);
  return (
    <WorkflowShell module="roadsonic" step="review" title="Event review" nextLabel="Summary" intro="Listen to an event, inspect its frequency pattern and read why it was flagged. Marking an event 'reviewed' here is a note for this session only; it is not a ground-truth label.">
      {r.events.length === 0 ? <EmptyState title="Nothing to review" body="The detector returned no candidate events." /> : <>
        <section className="card"><div className="form"><label>Event<select value={i ?? ""} onChange={(ev) => patchRs({ sel: ev.target.value === "" ? null : Number(ev.target.value) })}><option value="">Choose an event…</option>
          {r.events.map((x: any, k: number) => <option key={k} value={k}>#{k + 1} · {x.start_s.toFixed(2)}–{x.end_s.toFixed(2)} s{rs.reviewed[k] ? " · reviewed" : ""}</option>)}</select></label></div></section>
        {!e && <EmptyState title="Select an event" body="Choose one above or on the Events screen." />}
        {e && <>
          <section className="card stack"><h3>Event #{i! + 1} · {e.start_s.toFixed(3)}–{e.end_s.toFixed(3)} s ({e.duration_s.toFixed(2)} s)</h3><p>{e.explanation}</p>
            <div className="table-wrap"><table><thead><tr><th>Rule</th><th>Result</th></tr></thead><tbody>{Object.entries(e.rules).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{v ? "✔ passed" : "✖ not met"}</td></tr>)}</tbody></table></div>
            <p className="muted">Heuristic score {e.heuristic_score.toFixed(2)} = {e.score_definition}. It is not a calibrated probability.</p></section>
          <Plot title="Dominant frequency during the event" note={`Observed pattern: ${e.trajectory.pattern}. Describes the track only; it does not classify the siren type.`}
            data={[{ x: e.trajectory.time_s, y: e.trajectory.freq_hz, type: "scatter", mode: "lines+markers", marker: { size: 4, color: c.event }, line: { color: c.event }, name: "dominant frequency" }]} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Frequency (Hz)" } }} />
          <section className="card"><h3>Listen with 2 s of context{active ? ": original vs processed" : ""}</h3>
            {active ? <ABPlayer a={{ label: "Original", src: clip("original") }} b={{ label: "Processed", src: clip("processed") }} /> : <audio controls src={clip("original")} style={{ width: "100%" }} aria-label={`Event ${i! + 1} with context`} />}
            <label className="inline" style={{ marginTop: "1rem" }}><input type="checkbox" checked={!!rs.reviewed[i!]} onChange={(ev) => patchRs({ reviewed: { ...rs.reviewed, [i!]: ev.target.checked } })} /> Mark as reviewed (this session only; not a ground-truth label)</label>
            <div className="actions" style={{ marginTop: ".75rem" }}><button className="btn ghost" disabled={i === 0} onClick={() => patchRs({ sel: i! - 1 })}>Previous event</button><button className="btn ghost" disabled={i === r.events.length - 1} onClick={() => patchRs({ sel: i! + 1 })}>Next event</button><button className="btn ghost" onClick={() => nav("/roadsonic/events")}>Back to timeline</button></div></section></>}</>}
    </WorkflowShell>
  );
}

export function SummaryStep() {
  const { rs, discard } = useSession(), r = rs.res, nav = useNavigate(), [truth, setTruth] = useState(""), [ev, setEv] = useState<any>(null), [err, setErr] = useState(""), [confirm, setConfirm] = useState(false);
  useMarkLoaded("roadsonic", "summary", !!r);
  async function evaluate() {
    setErr(""); setEv(null);
    const rows = truth.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [a, b] = l.split(/[ ,;\t]+/).map(Number); return { start_s: a, end_s: b }; });
    if (rows.some((t) => !Number.isFinite(t.start_s) || !Number.isFinite(t.end_s))) { setErr("Each line must be: start_seconds, end_seconds"); return; }
    try { setEv(await postJson(`/api/v1/roadsonic/${r.job_id}/evaluate`, { truth: rows })); } catch (e: any) { setErr(e.message); }
  }
  const x = (k: string) => url(`/api/v1/roadsonic/${r.job_id}/export?kind=${k}`);
  return (
    <WorkflowShell module="roadsonic" step="summary" title="Detection summary and evaluation" hideNext>
      <section className="card stack"><h3>Detector output</h3>
        <div className="tiles"><Metric value={r.events.length} label="Candidate events" /><Metric value={`${r.summary.total_event_s.toFixed(2)} s`} label={`Total event time (${(100 * r.summary.event_fraction).toFixed(0)} %)`} /><Metric value={r.detect_on} label="Audio analysed" /><Metric value={`${r.processing_s.toFixed(2)} s`} label="Processing time" /></div>
        {r.events.length > 0 && <div className="table-wrap"><table><thead><tr><th>#</th><th>Start (s)</th><th>End (s)</th><th>Duration (s)</th><th>Score*</th><th>Pattern</th></tr></thead><tbody>
          {r.events.map((e: any, i: number) => <tr key={i}><td>{i + 1}</td><td>{e.start_s.toFixed(3)}</td><td>{e.end_s.toFixed(3)}</td><td>{e.duration_s.toFixed(2)}</td><td>{e.heuristic_score.toFixed(2)}</td><td>{e.trajectory.pattern}</td></tr>)}</tbody></table></div>}
        <p className="muted">*Heuristic evidence score, not a probability. Detection can be affected by distance, traffic noise, horns, speech, reverberation, vehicle motion and recording quality.</p></section>
      <section className="card stack"><h3>Evaluation against your own labels</h3>
        <p className="muted">Precision, recall and F1 need genuine ground truth. If you labelled the true siren intervals by listening, enter them (one per line: <code>start_seconds, end_seconds</code>). The numbers describe this recording and these settings only.</p>
        <label>Labelled intervals<textarea rows={4} value={truth} onChange={(e) => setTruth(e.target.value)} placeholder={"3.0, 7.0\n12.5, 15.0"} /></label>
        <div className="actions"><button className="btn" disabled={!truth.trim()} onClick={evaluate}>Compute metrics</button></div>{err && <ErrorPanel message={err} />}
        {ev && <div className="table-wrap"><table><tbody><tr><td>TP / FP / FN</td><td>{ev.true_positives} / {ev.false_positives} / {ev.false_negatives}</td></tr>
          <tr><td>Precision · Recall · F1</td><td>{[ev.precision, ev.recall, ev.f1].map((v: any) => v == null ? "n/a" : v.toFixed(2)).join(" · ")}</td></tr>
          <tr><td>Mean start / end error</td><td>{ev.mean_abs_start_error_s == null ? "n/a" : `${ev.mean_abs_start_error_s.toFixed(2)} / ${ev.mean_abs_end_error_s.toFixed(2)} s`}</td></tr><tr><td>False alarms per minute</td><td>{ev.false_alarms_per_minute?.toFixed(2)}</td></tr></tbody></table><p className="muted">{ev.note}</p></div>}
        <p className="muted">No machine-learning classifier exists in this project, so there is no trained-model accuracy to report.</p></section>
      <section className="card stack"><h3>Export</h3><div className="actions"><a className="btn ghost" href={x("events_csv")}>Events CSV</a><a className="btn ghost" href={x("events_json")}>Events JSON</a><a className="btn ghost" href={x("features_csv")}>Feature table CSV</a><a className="btn ghost" href={x("config_json")}>Settings JSON</a><a className="btn ghost" href={x("results_json")}>Full results JSON</a></div>
        <div className="actions"><a className="btn" href={url(`/api/v1/roadsonic/${r.job_id}/report?format=html`)}>HTML report</a><a className="btn" href={url(`/api/v1/roadsonic/${r.job_id}/report?format=pdf`)}>PDF report</a></div>
        <p className="muted">Exports contain this run's real results and the exact settings used.</p></section>
      <div className="actions"><button className="btn ghost" onClick={() => nav("/roadsonic/detect")}>Adjust settings</button><button className="btn danger" onClick={() => setConfirm(true)}>Start new analysis</button></div>
      <ConfirmDialog open={confirm} danger title="Start a new analysis?" body="The recording and all results are deleted from the server and this session. Export anything you need first." confirmLabel="Delete and start over" onCancel={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await discard("roadsonic"); nav("/roadsonic/upload"); }} />
    </WorkflowShell>
  );
}
