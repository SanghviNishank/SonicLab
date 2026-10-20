import { useRef, useState } from "react";
import Uploader from "../components/Uploader";
import Stats from "../components/Stats";
import Plot from "../components/Plot";
import { postJson, url } from "../api";

export default function RoadSonic() {
  const [up, setUp] = useState<any>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [cfg, setCfg] = useState({ min_tonal_ratio: 0.5, min_f0_range_hz: 150, min_event_s: 1.0 });
  const audio = useRef<HTMLAudioElement>(null);
  const id = up?.metadata.audio_id;

  async function detect() {
    setBusy(true); setErr("");
    try { setSel(null); setRes(await postJson(`/api/v1/roadsonic/${id}/detect`, { config: cfg })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  function play(e: any, i: number) {
    setSel(i);
    const a = audio.current; if (!a) return;
    a.currentTime = Math.max(0, e.start_s - 0.5); a.play();
    const stop = () => { if (a.currentTime >= e.end_s + 0.5) { a.pause(); a.removeEventListener("timeupdate", stop); } };
    a.addEventListener("timeupdate", stop);
  }
  const shapes = (res?.events ?? []).map((e: any, i: number) => ({ type: "rect", xref: "x", yref: "paper", x0: e.start_s, x1: e.end_s, y0: 0, y1: 1, fillcolor: i === sel ? "rgba(255,140,0,0.55)" : "rgba(255,170,0,0.25)", line: { width: i === sel ? 2 : 0, color: "#ff8c00" } }));
  const F = res?.features;

  return (
    <div className="stack">
      <h1>RoadSonic</h1>
      <p className="warn">Academic prototype. Events are <b>candidate</b> siren intervals from heuristic rules — not a certified or safety-critical warning.</p>
      <Uploader onDone={(r) => { setUp(r); setRes(null); }} onClear={() => { setUp(null); setRes(null); }} />
      {err && <p className="error" role="alert">⚠ {err}</p>}
      {up && <>
        <Stats res={up} />
        <audio ref={audio} controls src={url(`/api/v1/audio/${id}/file`)} style={{ width: "100%" }} aria-label="Traffic audio" />
        <section className="card"><h3>3 · Detector settings</h3>
          <div className="form">
            <label>Min tonal ratio (0–1)<input type="number" step={0.05} min={0} max={1} value={cfg.min_tonal_ratio} onChange={(e) => setCfg({ ...cfg, min_tonal_ratio: +e.target.value })} /></label>
            <label>Min frequency range (Hz)<input type="number" value={cfg.min_f0_range_hz} onChange={(e) => setCfg({ ...cfg, min_f0_range_hz: +e.target.value })} /></label>
            <label>Min event duration (s)<input type="number" step={0.1} value={cfg.min_event_s} onChange={(e) => setCfg({ ...cfg, min_event_s: +e.target.value })} /></label>
          </div>
          <button className="btn" disabled={busy} onClick={detect}>{busy ? "Analyzing…" : "Detect candidate events"}</button></section>
        {res && <>
          <Plot title="Waveform with candidate intervals" data={res.waveform.channels.map((c: any, i: number) => ({ x: c.t, y: c.y, type: "scatter", mode: "lines", name: `ch${i}` }))}
            layout={{ shapes, xaxis: { title: "Time (s)" } }} />
          {res.spectrogram && <Plot title="Spectrogram (dB re full scale) with candidate events" data={[{ x: res.spectrogram.times_s, y: res.spectrogram.freqs_hz, z: res.spectrogram.magnitude_db, type: "heatmap", zmin: -100, zmax: 0 }]}
            layout={{ shapes: shapes.map((sh: any) => ({ ...sh, line: { width: 1.5, color: "#ff8c00" }, fillcolor: sh.fillcolor.replace(/0\.\d+\)/, "0.18)") })), xaxis: { title: "Time (s)" }, yaxis: { title: "Frequency (Hz)" } }} />}
          {F && <Plot title="Dominant frequency & tonal ratio" data={[{ x: F.time_s, y: F.dom_freq_hz, type: "scatter", mode: "markers", marker: { size: 3 }, name: "dominant freq (Hz)" },
            { x: F.time_s, y: F.tonal_ratio, type: "scatter", mode: "lines", name: "tonal ratio", yaxis: "y2" }]}
            layout={{ shapes, xaxis: { title: "Time (s)" }, yaxis: { title: "Hz" }, yaxis2: { overlaying: "y", side: "right", range: [0, 1], title: "tonal ratio" } }} />}
          <section className="card"><h3>4 · Candidate events ({res.events.length})</h3>
            {res.events.length === 0 && <p className="muted">No candidate events under these rules. This does not prove no siren is present (see missed-detection limits in the docs).</p>}
            {res.events.map((e: any, i: number) => (
              <div key={i} className="event" aria-current={sel === i}><b>#{i + 1}</b> {e.start_s.toFixed(2)}–{e.end_s.toFixed(2)} s ({e.duration_s.toFixed(2)} s) · score {e.heuristic_score.toFixed(2)} (heuristic, not a probability)
                <div className="muted">tonal fraction {e.features.tonal_fraction.toFixed(2)} · f0 range {e.features.f0_range_hz.toFixed(0)} Hz · f0 std {e.features.f0_std_hz.toFixed(0)} Hz · rules: {Object.entries(e.rules).map(([k, v]) => `${k}=${String(v)}`).join(", ")}</div>
                <button className="btn ghost" onClick={() => play(e, i)}>▶ Play around event</button></div>))}
            <p className="actions">{[["events_csv", "Events CSV"], ["events_json", "Events JSON"], ["features_csv", "Features CSV"], ["config_json", "Config JSON"]].map(([k, l]) =>
              <a key={k} className="btn ghost" href={url(`/api/v1/roadsonic/${res.job_id}/export?kind=${k}`)}>{l}</a>)}</p>
            <p className="actions"><a className="btn ghost" href={url(`/api/v1/roadsonic/${res.job_id}/report?format=html`)}>HTML report</a>
              <a className="btn ghost" href={url(`/api/v1/roadsonic/${res.job_id}/report?format=pdf`)}>PDF report</a></p>
            <p className="muted">{res.disclaimer}</p></section></>}
      </>}
    </div>
  );
}
