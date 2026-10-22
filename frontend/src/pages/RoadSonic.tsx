import { useEffect, useMemo, useRef, useState } from "react";
import Uploader from "../components/Uploader";
import Stats from "../components/Stats";
import Plot from "../components/Plot";
import SettingsPanel, { buildSettings, toRequest, validate } from "../features/roadsonic/SettingsPanel";
import EventsPanel, { EventTimeline } from "../features/roadsonic/EventsPanel";
import { call, postJson, url } from "../api";
import "../features/roadsonic/roadsonic.css";

const TABS = [["overview", "Overview"], ["analysis", "Analysis"], ["events", "Events"], ["compare", "Compare"], ["evaluation", "Evaluation"], ["export", "Export"]] as const;
const AMBER = "#ffb020", CYAN = "#22d3ee";

function waveTraces(w: any, name: string, opacity = 1): any[] {
  return w.channels.map((c: any, i: number) => ({ x: c.t, y: c.y, type: "scatter", mode: "lines", name: `${name} ch${i}`, line: { width: 1 }, opacity }));
}

export default function RoadSonic() {
  const [defaults, setDefaults] = useState<any>(null);
  const [s, setS] = useState<any>(null);
  const [up, setUp] = useState<any>(null);
  const [res, setRes] = useState<any>(null);
  const [lastRun, setLastRun] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<string>("overview");
  const [sel, setSel] = useState<number | null>(null);
  const [pre, setPre] = useState(2);
  const [post, setPost] = useState(2);
  const [cursor, setCursor] = useState<number | null>(null);
  const [clip, setClip] = useState<{ src: string; key: string; start: number } | null>(null);
  const [xr, setXr] = useState<[number, number] | null>(null);
  const [rev, setRev] = useState(0);
  const [feats, setFeats] = useState<string[]>(["rms_db", "flatness"]);
  const [truthText, setTruthText] = useState("");
  const [evalRes, setEvalRes] = useState<any>(null);
  const main = useRef<HTMLAudioElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    call("/api/v1/roadsonic/defaults").then((d) => { setDefaults(d); setS(buildSettings(d)); }).catch((e) => setErr("Could not load detector defaults: " + e.message));
  }, []);

  const id = up?.metadata.audio_id;
  const dirty = !!res && !!s && JSON.stringify(toRequest(s)) !== lastRun;
  const duration: number = res?.summary.duration_s ?? up?.metadata.duration_s ?? 0;

  async function run(audioId = id, settings = s) {
    if (!audioId || !settings) return;
    const mine = ++reqId.current;                                  // ignore results of superseded requests
    const body = toRequest(settings);
    setBusy(true); setErr(""); setEvalRes(null);
    try {
      const r = await postJson(`/api/v1/roadsonic/${audioId}/detect`, body);
      if (mine !== reqId.current) return;
      setRes(r); setLastRun(JSON.stringify(body)); setSel(null); setClip(null); setXr(null); setRev((v) => v + 1);
    } catch (e: any) { if (mine === reqId.current) setErr(e.message); }
    finally { if (mine === reqId.current) setBusy(false); }
  }

  function select(i: number) {
    setSel(i); const e = res.events[i];
    setXr([Math.max(0, e.start_s - pre), Math.min(duration, e.end_s + post)]); setRev((v) => v + 1);
    if (main.current) { main.current.currentTime = Math.max(0, e.start_s - pre); }
    setCursor(e.start_s);
  }
  function play(i: number) {
    select(i); const e = res.events[i];
    main.current?.pause();
    const start = Math.max(0, e.start_s - pre);
    setClip({ src: url(`/api/v1/roadsonic/${res.job_id}/event/${i}/audio?pre=${pre}&post=${post}&version=original`), key: `${res.job_id}-${i}-${pre}-${post}`, start });
  }
  function seek(t: number) { if (main.current) main.current.currentTime = t; setCursor(t); }

  const shapes = useMemo(() => {
    const sh: any[] = (res?.events ?? []).flatMap((e: any, i: number) => [{ type: "rect", xref: "x", yref: "paper", x0: e.start_s, x1: e.end_s, y0: 0, y1: 1,
      fillcolor: i === sel ? "rgba(255,176,32,0.45)" : "rgba(255,176,32,0.2)", line: { width: i === sel ? 2.5 : 1.2, color: AMBER, dash: i === sel ? "solid" : "dot" } }]);
    if (cursor != null) sh.push({ type: "line", xref: "x", yref: "paper", x0: cursor, x1: cursor, y0: 0, y1: 1, line: { color: CYAN, width: 2 } });
    return sh;
  }, [res, sel, cursor]);
  const annotations = (res?.events ?? []).map((e: any, i: number) => ({ x: (e.start_s + e.end_s) / 2, xref: "x", y: 1, yref: "paper", text: `#${i + 1}`, showarrow: false, yanchor: "bottom", font: { color: AMBER } }));
  const xaxis = (title: string) => ({ title, range: xr ?? undefined, autorange: xr == null });
  const base = { shapes, annotations, uirevision: String(rev) };

  async function evaluate() {
    setErr("");
    const truth = truthText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [a, b] = l.split(/[ ,;\t]+/).map(Number); return { start_s: a, end_s: b }; });
    if (truth.some((t) => !Number.isFinite(t.start_s) || !Number.isFinite(t.end_s))) { setErr("Each line must be: start_seconds, end_seconds"); return; }
    try { setEvalRes(await postJson(`/api/v1/roadsonic/${res.job_id}/evaluate`, { truth })); } catch (e: any) { setErr(e.message); }
  }

  const status = busy ? "Analyzing…" : !up ? "No recording" : !res ? "Ready to analyze" : dirty ? "Settings changed - rerun needed" : "Analysis current";
  const pre_ = res?.preprocessing;
  const prepSummary = !res ? "—" : pre_.active ? pre_.processing_steps.map((p: any) => p.step === "filter" ? `${p.detail.filter_type} ${p.detail.cutoff_hz.join("–")} Hz (${p.detail.method})` : "noise reduction").join(" + ") : "none (mono mix + DC removal only)";
  const F = res?.tracks;
  const featDefs: [string, string][] = [["rms_db", "RMS level (dBFS)"], ["centroid_hz", "Spectral centroid (Hz)"], ["bandwidth_hz", "Spectral bandwidth (Hz)"], ["flatness", "Spectral flatness"],
    ["peak_prominence_db", "Peak prominence (dB)"], ["tonal_ratio", "Tonal ratio"], ["zcr", "Zero-crossing rate"]];

  return (
    <div className="rs stack">
      <header className="rs-top">
        <div className="rs-brand"><span className="rs-mark" aria-hidden="true">◉</span><div><h1>RoadSonic</h1><span className="muted">Emergency Audio Intelligence Lab</span></div></div>
        <nav aria-label="RoadSonic sections" className="rs-nav" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{k === "events" && res ? ` (${res.events.length})` : ""}</button>)}
        </nav>
        <span className={"rs-chip " + (busy ? "run" : dirty ? "warn" : res ? "ok" : "")} role="status" aria-live="polite">{status}</span>
      </header>
      <p className="warn">Academic prototype. Events are <b>candidate</b> siren intervals from heuristic rules - not confirmed sirens and not a safety-critical warning system.</p>
      {err && <p className="error" role="alert">⚠ {err}</p>}

      <div className="rs-layout">
        <div className="rs-main">
          {tab === "overview" && <>
            <Uploader onDone={(r) => { setUp(r); setRes(null); setSel(null); setClip(null); if (s) run(r.metadata.audio_id, s); }} onClear={() => { setUp(null); setRes(null); setSel(null); setClip(null); }} />
            {up && <Stats res={up} />}
            <section className="card"><h3>Analysis overview</h3>
              <div className="rs-tiles">
                <div><b>{up ? up.metadata.duration_s.toFixed(2) + " s" : "—"}</b><span>duration</span></div>
                <div><b>{up ? up.metadata.sample_rate_hz + " Hz" : "—"}</b><span>sampling rate</span></div>
                <div><b>{res ? res.events.length : "—"}</b><span>candidate events</span></div>
                <div><b>{res ? res.summary.total_event_s.toFixed(2) + " s" : "—"}</b><span>total event time ({res ? (100 * res.summary.event_fraction).toFixed(0) : "—"} %)</span></div>
                <div><b>{status}</b><span>status</span></div>
                <div><b>{res ? res.detect_on : "—"}</b><span>audio analysed</span></div>
              </div>
              <p className="muted">Preprocessing: {prepSummary}. {res && `Computed in ${res.processing_s.toFixed(1)} s by ${res.engine}.`}</p>
              {res && <p className="muted">{res.detect_on_note}</p>}
            </section>
            {res ? <section className="card"><h3>Timeline</h3><EventTimeline events={res.events} duration={duration} sel={sel} cursor={cursor} onSelect={(i) => { select(i); setTab("events"); }} /></section>
              : <div className="card empty"><h3>Start here</h3><p className="muted">Upload a traffic recording (WAV, FLAC, MP3, OGG, M4A or AIFF, mono or stereo). Analysis runs automatically with the settings on the right.</p></div>}
          </>}

          {res && tab !== "overview" && <section className="card rs-player"><h3>Recording playback</h3>
            <audio ref={main} controls src={url(`/api/v1/roadsonic/${res.job_id}/audio?version=original`)} style={{ width: "100%" }} aria-label="Original recording"
              onTimeUpdate={(e) => setCursor((e.target as HTMLAudioElement).currentTime)} />
            <p className="actions"><button className="btn ghost" onClick={() => { setXr(null); setRev((v) => v + 1); }}>Reset zoom</button>
              <span className="muted">Click a plot to move the playhead. Cyan line = playhead; amber dotted boxes = candidate events (numbered).</span></p></section>}

          {res && tab === "analysis" && <>
            <Plot title="Waveform with candidate events" note="Display decimated (min/max preserved); analysis uses every sample." data={waveTraces(res.waveform, "original")} onClick={seek}
              layout={{ ...base, xaxis: xaxis("Time (s)"), yaxis: { title: "Amplitude (full scale = 1)" } }} />
            <Plot title="Single-sided amplitude spectrum" note={`Hann window · bin spacing ${res.spectrum.bin_spacing_hz.toFixed(3)} Hz · analysed: ${res.spectrum.analysed}. Peak estimates: ${res.spectrum.peaks.map((p: any) => p.frequency_hz.toFixed(0) + " Hz").join(", ") || "none"}`}
              data={[{ x: res.spectrum.freqs_hz, y: res.spectrum.amplitude, type: "scatter", mode: "lines", name: "amplitude" }]}
              layout={{ xaxis: { title: "Frequency (Hz)", range: [0, Math.min(res.summary.sample_rate_hz / 2, 6000)] }, yaxis: { title: "Amplitude (full scale = 1)", type: "log" } }} />
            <Plot title="Spectrogram with candidate events" note={`dB re full-scale single-sided amplitude · frame ${res.spectrogram.frame_length}, hop ${res.spectrogram.hop_length}`} height={360} onClick={seek}
              data={[{ x: res.spectrogram.times_s, y: res.spectrogram.freqs_hz, z: res.spectrogram.magnitude_db, type: "heatmap", zmin: -100, zmax: 0, colorbar: { title: "dB" } }]}
              layout={{ ...base, xaxis: xaxis("Time (s)"), yaxis: { title: "Frequency (Hz)", range: [0, Math.min(res.summary.sample_rate_hz / 2, 4000)] } }} />
            <Plot title="Dominant-frequency track and tonal ratio" note="A siren makes the dominant frequency sweep or alternate while the tonal ratio stays high; a steady horn stays flat." onClick={seek}
              data={[{ x: F.time_s, y: F.dom_freq_hz, type: "scatter", mode: "markers", marker: { size: 3 }, name: "dominant frequency (Hz)" },
                { x: F.time_s, y: F.tonal_ratio, type: "scatter", mode: "lines", name: "tonal ratio", yaxis: "y2" }]}
              layout={{ ...base, xaxis: xaxis("Time (s)"), yaxis: { title: "Hz" }, yaxis2: { overlaying: "y", side: "right", range: [0, 1], title: "tonal ratio" } }} />
            <section className="card"><h3>Feature tracks</h3>
              <fieldset className="rs-feats"><legend>Choose features to plot</legend>{featDefs.map(([k, l]) => <label key={k} className="inline"><input type="checkbox" checked={feats.includes(k)}
                onChange={(e) => setFeats(e.target.checked ? [...feats, k] : feats.filter((x) => x !== k))} /> {l}</label>)}</fieldset>
              <details><summary>What each feature means and its limits</summary><dl>{Object.entries(defaults?.features_help ?? {}).map(([k, v]: any) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details></section>
            {feats.length > 0 && <Plot title="Selected feature tracks" height={Math.max(260, 150 * feats.length)} onClick={seek}
              data={feats.map((k, i) => ({ x: F.time_s, y: F[k], type: "scatter", mode: "lines", name: featDefs.find((d) => d[0] === k)![1], xaxis: "x", yaxis: i === 0 ? "y" : `y${i + 1}` }))}
              layout={{ ...base, grid: { rows: feats.length, columns: 1, pattern: "coupled" }, xaxis: xaxis("Time (s)"),
                ...Object.fromEntries(feats.map((k, i) => [i === 0 ? "yaxis" : `yaxis${i + 1}`, { title: featDefs.find((d) => d[0] === k)![1].split(" (")[0] }])) }} />}
          </>}

          {res && tab === "events" && <>
            <section className="card"><h3>Event timeline</h3><EventTimeline events={res.events} duration={duration} sel={sel} cursor={cursor} onSelect={select} /></section>
            <EventsPanel res={res} sel={sel} onSelect={select} onPlay={play} pre={pre} post={post} setPre={setPre} setPost={setPost} clipSrc={clip?.src ?? null} clipKey={clip?.key ?? ""} clipStart={clip?.start ?? 0} onClipTime={setCursor} jobId={res.job_id} />
          </>}

          {res && tab === "compare" && (res.preprocessing.active ? <>
            <section className="card"><h3>Original vs processed audio</h3>
              <p className="muted">Detection results above came from the <b>{res.detect_on}</b> audio. Preprocessing: {prepSummary}.</p>
              <label>Original (mix + DC)<audio controls src={url(`/api/v1/roadsonic/${res.job_id}/audio?version=original`)} style={{ width: "100%" }} /></label>
              <label>Processed<audio controls src={url(`/api/v1/roadsonic/${res.job_id}/audio?version=processed`)} style={{ width: "100%" }} /></label>
              {res.comparison && <div className="table-wrap"><table><thead><tr><th>Version</th><th>Candidate events</th><th>Total event time</th></tr></thead><tbody>
                {(["original", "processed"] as const).map((v) => <tr key={v}><td>{v}{v === res.detect_on ? " (shown)" : ""}</td><td>{res.comparison[v].n_events}</td><td>{res.comparison[v].total_event_s.toFixed(2)} s</td></tr>)}</tbody></table></div>}
              {res.comparison && <p className="muted">{res.comparison.note}</p>}
            </section>
            {res.waveform_processed && <Plot title="Waveform: original vs processed (channel 0 / processed mono)" data={[...waveTraces(res.waveform, "original").slice(0, 1), ...waveTraces(res.waveform_processed, "processed")]} layout={{ xaxis: { title: "Time (s)" } }} onClick={seek} />}
            {res.spectrogram_original && <>
              <Plot title="Spectrogram - original" height={300} data={[{ x: res.spectrogram_original.times_s, y: res.spectrogram_original.freqs_hz, z: res.spectrogram_original.magnitude_db, type: "heatmap", zmin: -100, zmax: 0 }]} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Hz", range: [0, 4000] } }} />
              <Plot title="Spectrogram - processed" height={300} data={[{ x: res.spectrogram.times_s, y: res.spectrogram.freqs_hz, z: res.spectrogram.magnitude_db, type: "heatmap", zmin: -100, zmax: 0 }]} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Hz", range: [0, 4000] } }} /></>}
            {res.comparison && <Plot title="Dominant-frequency tracks: original vs processed" data={(["original", "processed"] as const).map((v) => ({ x: res.comparison[v].tracks.time_s, y: res.comparison[v].tracks.dom_freq_hz, type: "scatter", mode: "markers", marker: { size: 3 }, name: v }))} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Hz" } }} />}
          </> : <div className="card empty"><h3>No processed version yet</h3><p className="muted">Open <b>Preprocessing</b> in the settings panel, choose a filter or enable noise reduction, then rerun. Filtering can remove siren harmonics, so compare carefully.</p></div>)}

          {res && tab === "evaluation" && <section className="card"><h3>Evaluation against your labels</h3>
            <p className="muted">Enter the true siren intervals you labelled by listening, one per line as <code>start_seconds, end_seconds</code>. Metrics are computed from this run's events (greedy matching, IoU ≥ 0.3). They describe this recording and these settings only; they are not a general accuracy.</p>
            <label>Labelled intervals<textarea rows={5} value={truthText} onChange={(e) => setTruthText(e.target.value)} placeholder={"3.0, 7.0\n12.5, 15.0"} /></label>
            <p className="actions"><button className="btn" onClick={evaluate} disabled={!truthText.trim()}>Compute metrics</button></p>
            {evalRes && <div className="table-wrap"><table><tbody>
              <tr><td>True positives / false positives / false negatives</td><td>{evalRes.true_positives} / {evalRes.false_positives} / {evalRes.false_negatives}</td></tr>
              <tr><td>Precision · Recall · F1</td><td>{[evalRes.precision, evalRes.recall, evalRes.f1].map((v: any) => v == null ? "n/a" : v.toFixed(2)).join(" · ")}</td></tr>
              <tr><td>Mean start / end error</td><td>{evalRes.mean_abs_start_error_s == null ? "n/a" : `${evalRes.mean_abs_start_error_s.toFixed(2)} / ${evalRes.mean_abs_end_error_s.toFixed(2)} s`}</td></tr>
              <tr><td>False alarms per minute</td><td>{evalRes.false_alarms_per_minute?.toFixed(2)}</td></tr></tbody></table><p className="muted">{evalRes.note}</p></div>}
            <p className="muted">No machine-learning classifier is implemented: no licensed, source-separated dataset was used, so no trained-model accuracy exists.</p></section>}

          {res && tab === "export" && <section className="card"><h3>Export</h3>
            <p className="actions">{[["events_csv", "Events CSV"], ["events_json", "Events JSON"], ["features_csv", "Feature table CSV"], ["config_json", "Configuration JSON"], ["results_json", "Full results JSON"]].map(([k, l]) =>
              <a key={k} className="btn ghost" href={url(`/api/v1/roadsonic/${res.job_id}/export?kind=${k}`)}>{l}</a>)}
              <a className="btn" href={url(`/api/v1/roadsonic/${res.job_id}/report?format=html`)}>HTML report</a>
              <a className="btn" href={url(`/api/v1/roadsonic/${res.job_id}/report?format=pdf`)}>PDF report</a></p>
            <p className="muted">Exports contain this run's real results and the exact settings used. Per-event audio clips are in the Events tab. An annotated full-length WAV is not implemented.</p></section>}

          {!res && tab !== "overview" && <div className="card empty"><p className="muted">{busy ? "Analyzing…" : "Upload a recording on the Overview tab to see this section."}</p></div>}
        </div>
        {defaults && s && <SettingsPanel defaults={defaults} s={s} setS={setS} dirty={dirty} busy={busy} hasAudio={!!id} onRun={() => run()} onReset={() => setS(buildSettings(defaults))} />}
      </div>
    </div>
  );
}
