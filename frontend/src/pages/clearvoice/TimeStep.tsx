import { useState } from "react";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import { WaveformChart } from "../../components/charts";
import { ErrorPanel } from "../../components/ui";
import { useMarkLoaded, useSession } from "../../context/Session";
import { postJson } from "../../api";

export default function TimeStep() {
  const { cv } = useSession(), up = cv.upload, id = up.metadata.audio_id;
  const [range, setRange] = useState<[number, number] | null>(null), [ch, setCh] = useState(0), [res, setRes] = useState<any>(null), [err, setErr] = useState(""), [rev, setRev] = useState(0);
  useMarkLoaded("clearvoice", "time-analysis", !!up);
  async function measure() {
    setErr("");
    const a = range ? Math.max(0, range[0]) : 0, b = range ? Math.min(up.metadata.duration_s, range[1]) : up.metadata.duration_s;
    try { setRes(await postJson(`/api/v1/audio/${id}/range-stats`, { start_s: a, end_s: b, channel: ch })); } catch (e: any) { setErr(e.message); setRes(null); }
  }
  const st = res?.statistics;
  return (
    <WorkflowShell module="clearvoice" step="time-analysis" title="Time-domain analysis" intro="Zoom and pan the waveform, then measure the visible range. Measurements use every original sample in that range, never the decimated display data.">
      <WaveformChart original={up.waveform} onRange={setRange} layout={{ uirevision: String(rev), dragmode: "zoom" }} title="Waveform (drag to zoom, double-click to reset)" />
      <section className="card stack"><h3>Measure a range</h3>
        <div className="form"><label>Channel<select value={ch} onChange={(e) => setCh(Number(e.target.value))}>{Array.from({ length: up.metadata.channels }, (_, i) => <option key={i} value={i}>Channel {i}</option>)}</select></label>
          <label>Visible range<input readOnly value={range ? `${range[0].toFixed(3)} – ${range[1].toFixed(3)} s` : `whole recording (0 – ${up.metadata.duration_s.toFixed(3)} s)`} /></label></div>
        <div className="actions"><button className="btn" onClick={measure}>Measure {range ? "visible range" : "whole recording"}</button><button className="btn ghost" onClick={() => { setRange(null); setRes(null); setRev((v) => v + 1); }}>Reset zoom</button></div>
        {err && <ErrorPanel message={err} />}
        {st && <div className="stack"><p className="muted">Samples {res.start_sample.toLocaleString()} – {res.end_sample.toLocaleString()} ({res.n_samples.toLocaleString()} samples, {res.start_s.toFixed(4)} – {res.end_s.toFixed(4)} s)</p>
          <div className="tiles"><div className="tile"><b>{st.peak_abs.toFixed(4)}</b><span>Peak</span></div><div className="tile"><b>{st.rms.toFixed(4)}</b><span>RMS</span></div><div className="tile"><b>{st.mean.toFixed(6)}</b><span>Mean</span></div>
            <div className="tile"><b>{st.variance.toFixed(6)}</b><span>Variance (population)</span></div><div className="tile"><b>{st.crest_factor == null ? "—" : st.crest_factor.toFixed(2)}</b><span>Crest factor</span></div><div className="tile"><b>{st.clipped_samples}</b><span>Samples near full scale</span></div></div></div>}
      </section>
    </WorkflowShell>
  );
}
