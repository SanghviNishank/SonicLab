import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Presentation, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import { del, postJson, isAborted } from "../../api";
import AudioUploader from "../../components/audio/AudioUploader";
import { SpectrogramChart, SpectrumChart, WaveformChart, FilterResponseChart } from "../../components/charts";
import Plot from "../../components/Plot";
import { ErrorPanel, MetadataPanel, ProcessingStatus } from "../../components/ui";
import { useSession } from "../../context/Session";
import { chartColors } from "../../components/charts/colors";
import BeforeAfterStudio from "../studio/BeforeAfterStudio";
import { useAnalysis, DEFAULT_PARAMS } from "../../pages/clearvoice/useAnalysis";
import { useRoadSonic } from "../../pages/roadsonic/useRoadSonic";
import { buildFacts } from "../../logic/learnFacts.ts";
import { eventOverlays } from "../roadsonic/overlays";
import { presentation, usePresentation } from "./state";
import { progressLabel, stepReady, stepsFor, type PStep, type ModuleKey } from "./steps.ts";
import { url } from "../../api";

function Missing({ msg, children }: { msg: string; children?: React.ReactNode }) { return <div className="empty" role="status"><p><b>{msg}</b></p>{children}</div>; }

function ClearVoiceStage({ step }: { step: PStep }) {
  const { cv, patchCv } = useSession(), { run, busy, error } = useAnalysis();
  const [applyBusy, setApplyBusy] = useState(false), [applyErr, setApplyErr] = useState("");
  const up = cv.upload, r = cv.filter?.result, fs = up?.metadata.sample_rate_hz, sp = cv.analysis?.spectrum;
  async function uploaded(res: any) { const old = cv.upload?.metadata.audio_id; patchCv({ upload: res, analysis: null, filter: null, loaded: {} }); if (old) { try { await del(`/api/v1/audio/${old}`); } catch { /* expired */ } } }
  async function applyDemo() {                                              // a real backend filter run, using a speech-band band-pass as the demonstration choice
    if (!up) return; setApplyBusy(true); setApplyErr("");
    try { const result = await postJson(`/api/v1/clearvoice/${up.metadata.audio_id}/filter`, { filter_type: "bandpass", order: 4, cutoff_hz: [300, 3400], method: "zero_phase" });
      patchCv({ filter: { kind: "filter", requestKey: "presentation-demo", label: "bandpass 300–3400 Hz, order 4, zero_phase", result } }); }
    catch (e: any) { if (!isAborted(e)) setApplyErr(e.message); } finally { setApplyBusy(false); }
  }
  const noUp = !up && step.need !== "none";
  switch (step.id) {
    case "intro": return <div className="stack"><h2>ClearVoice</h2><ul className="big-list"><li>Look at a recording in time and in frequency</li><li>Design a digital filter and see its effect</li><li>Compare the original and the processed audio</li></ul></div>;
    case "upload": return up ? <MetadataPanel upload={up} fileName={up.file?.name} /> : <AudioUploader onUploaded={uploaded} />;
    case "waveform": return noUp ? <Missing msg="Upload a recording to see its waveform." /> : <WaveformChart original={up.waveform} title="Waveform: time and amplitude" />;
    case "frequency":
      if (noUp) return <Missing msg="Upload a recording first." />;
      if (!sp) return <Missing msg="The frequency analysis has not been run yet."><button className="btn" disabled={busy} onClick={() => run(DEFAULT_PARAMS)}>{busy ? "Analysing…" : "Run frequency analysis"}</button>{error && <ErrorPanel message={error} />}</Missing>;
      return <div className="stack"><SpectrumChart xmax={Math.min(fs / 2, 8000)} spectra={[{ name: sp.window, freqs_hz: sp.freqs_hz, amplitude: sp.amplitude }]} />
        <p className="big">{sp.peaks.length ? `Strongest components: ${sp.peaks.slice(0, 3).map((p: any) => p.frequency_hz.toFixed(1) + " Hz").join(", ")}` : "No clear spectral peak."}</p></div>;
    case "filtering": return <div className="stack"><div className="analogy"><b>The gate analogy</b><p>A filter is a gate for sound frequencies. Some are allowed through, others are reduced.</p></div>
      {r?.response ? <FilterResponseChart response={r.response} cutoffs={r.config.cutoff_hz ?? []} fs={fs} /> : <p className="muted">The response graph of the filter appears here once a filter has been applied. Use the Visual Filter Lab in ClearVoice to design one, or apply the demonstration filter in the next step.</p>}</div>;
    case "processing":
      if (noUp) return <Missing msg="Upload a recording first." />;
      if (!r) return <Missing msg="No filter has been applied to this recording yet.">
        <button className="btn" disabled={applyBusy} onClick={applyDemo}>{applyBusy ? "Filtering…" : "Apply a 300–3400 Hz band-pass (demonstration)"}</button>
        <p className="muted">This runs the real backend filter on your recording. You can also design your own in the Visual Filter Lab.</p>{applyBusy && <ProcessingStatus label="Filtering the recording on the server…" />}{applyErr && <ErrorPanel message={applyErr} />}</Missing>;
      return <div className="stack"><p className="big">Applied: {cv.filter.label} · {r.processing_s?.toFixed(2)} s on the server</p><WaveformChart original={r.waveform_original} filtered={r.waveform_filtered} title="Waveform: original vs processed" /></div>;
    case "comparison":
      if (noUp || !r) return <Missing msg={noUp ? "Upload a recording first." : "Apply a filter first, then compare."} />;
      return <BeforeAfterStudio audioId={up.metadata.audio_id} jobId={r.job_id} fs={fs} waveOriginal={r.waveform_original} waveProcessed={r.waveform_filtered} settingsLabel={cv.filter.label} config={r.config} />;
    case "results":
      if (!r) return <Missing msg={noUp ? "Upload a recording first." : "Apply a filter to see results."} />;
      return <div className="stack"><SpectrumChart xmax={Math.min(fs / 2, 8000)} title="Spectrum: original vs processed" spectra={[{ name: "original", ...r.spectrum_original }, { name: "processed", ...r.spectrum_filtered }]} />
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Ch</th><th>RMS before</th><th>RMS after</th><th>Change (dB)</th></tr></thead><tbody>{r.metrics.per_channel.map((m: any, i: number) => <tr key={i}><td>{i}</td><td>{m.rms_before.toFixed(5)}</td><td>{m.rms_after.toFixed(5)}</td><td>{m.rms_change_db == null ? "n/a" : m.rms_change_db.toFixed(2)}</td></tr>)}</tbody></table></div>
        <ul className="muted"><li>A lower RMS does not automatically mean better audio.</li><li>No SNR is claimed: there is no clean reference.</li><li>Filtering cannot recover information that was never recorded.</li></ul>
        <a className="btn ghost" href={url(`/api/v1/clearvoice/${r.job_id}/report?format=pdf`)}>Download PDF report</a></div>;
    case "conclusion": return <div className="stack"><ul className="big-list"><li>Real audio was analysed in time and frequency</li><li>A validated Butterworth filter was designed and applied on the backend</li><li>Original and processed audio were compared by listening and measurement</li><li>Limits are stated: no improvement is claimed without evidence</li></ul><p className="muted">Learn the ideas behind each step in <Link to="/learn" onClick={presentation.exit}>Learn DSP</Link>.</p></div>;
    default: return null;
  }
}

function RoadSonicStage({ step }: { step: PStep }) {
  const { rs, patchRs } = useSession(), { run, busy, error, settings } = useRoadSonic(), c = chartColors();
  const up = rs.upload, r = rs.res, fs = up?.metadata.sample_rate_hz;
  async function uploaded(res: any) { const old = rs.upload?.metadata.audio_id; patchRs({ upload: res, res: null, detected: false, sel: null, reviewed: {}, loaded: {}, lastRun: "" }); if (old) { try { await del(`/api/v1/audio/${old}`); } catch { /* expired */ } } }
  const needAnalysis = (what: string) => !up ? <Missing msg="Upload a traffic recording first." /> : <Missing msg={`The analysis has not been run yet, so there is no ${what} to show.`}><button className="btn" disabled={busy || !settings} onClick={() => run(settings, false)}>{busy ? "Analysing…" : "Analyse recording"}</button>{error && <ErrorPanel message={error} />}</Missing>;
  switch (step.id) {
    case "intro": return <div className="stack"><h2>RoadSonic</h2><ul className="big-list"><li>Look for sounds that might be emergency sirens</li><li>Show the evidence behind every candidate</li><li>An academic prototype, not a safety system</li></ul></div>;
    case "upload": return up ? <MetadataPanel upload={up} fileName={up.file?.name} /> : <AudioUploader onUploaded={uploaded} />;
    case "waveform": return !r ? needAnalysis("waveform analysis") : <WaveformChart original={r.waveform} title="Waveform: time and amplitude" />;
    case "frequency": return !r ? needAnalysis("spectrum") : <SpectrumChart xmax={Math.min(fs / 2, 6000)} spectra={[{ name: "spectrum", ...r.spectrum }]} />;
    case "spectrogram": return !r ? needAnalysis("spectrogram") : <SpectrogramChart sg={r.spectrogram} fmax={Math.min(fs / 2, 4000)} />;
    case "features": { if (!r) return needAnalysis("features"); const T = r.tracks;
      return <Plot title="Dominant-frequency track and tonal ratio" note="A siren makes the dominant frequency sweep or alternate while the tonal ratio stays high."
        data={[{ x: T.time_s, y: T.dom_freq_hz, type: "scatter", mode: "markers", marker: { size: 3, color: c.c1 }, name: "dominant frequency (Hz)" }, { x: T.time_s, y: T.tonal_ratio, type: "scatter", mode: "lines", name: "tonal ratio", yaxis: "y2", line: { color: c.c2 } }]}
        layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Hz" }, yaxis2: { overlaying: "y", side: "right", range: [0, 1], title: "tonal ratio" } }} />; }
    case "events": case "evidence": {
      if (!up) return <Missing msg="Upload a traffic recording first." />;
      if (!rs.detected) return <Missing msg="Candidate detection has not been run yet."><button className="btn" disabled={busy || !settings} onClick={() => run(settings, true)}>{busy ? "Detecting…" : "Run candidate detection"}</button>{busy && <ProcessingStatus label="Running detection on the full-resolution audio…" />}{error && <ErrorPanel message={error} />}</Missing>;
      const ev: any[] = r.events;
      if (!ev.length) return <Missing msg="No candidate events were found with these settings."><p className="muted">That does not prove that no siren is present.</p></Missing>;
      if (step.id === "events") { const ov = eventOverlays(ev, null);
        return <div className="stack"><SpectrogramChart sg={r.spectrogram} title="Spectrogram with candidate events" fmax={Math.min(fs / 2, 4000)} shapes={ov.shapes} />
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>#</th><th>Start (s)</th><th>End (s)</th><th>Heuristic score*</th></tr></thead><tbody>{ev.map((e, i) => <tr key={i}><td>{i + 1}</td><td>{e.start_s.toFixed(2)}</td><td>{e.end_s.toFixed(2)}</td><td>{e.heuristic_score.toFixed(2)}</td></tr>)}</tbody></table></div><p className="muted">*A ranking heuristic, not a probability. These are candidates, not confirmed sirens.</p></div>; }
      return <div className="stack">{ev.slice(0, 3).map((e, i) => <section key={i} className="card"><h3>Candidate #{i + 1} · {e.start_s.toFixed(2)}–{e.end_s.toFixed(2)} s</h3><p>{e.explanation}</p><p className="muted mono">{Object.entries(e.rules).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p></section>)}{ev.length > 3 && <p className="muted">…and {ev.length - 3} more in the Events step.</p>}</div>; }
    case "limits": return <ul className="big-list"><li>Rules are hand-written and not validated as a safety system</li><li>Horns, alarms and music can cause false alarms</li><li>Weak or distant sirens can be missed</li><li>Future work: labelled evaluation and a learned model for comparison</li></ul>;
    default: return null;
  }
}

/** Full-screen guided demonstration. It renders the REAL session data (it does not unmount or reset the app underneath), and every step that needs data says so
 *  and offers a real backend action instead of showing placeholder results. */
export default function PresentationHost() {
  const { open, module, index } = usePresentation(), { cv, rs } = useSession(), reduced = useReducedMotion(), ref = useRef<HTMLDivElement>(null);
  const steps = module ? stepsFor(module) : [], step = steps[index], n = steps.length;
  const facts = useMemo(() => buildFacts(cv, rs), [cv, rs]);
  const avail = { hasUpload: module === "clearvoice" ? !!cv.upload : !!rs.upload, hasAnalysis: module === "clearvoice" ? !!cv.analysis?.spectrum : !!rs.res, hasFilter: !!cv.filter?.result, hasDetection: rs.detected };
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null; ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") presentation.exit();
      const t = e.target as HTMLElement; if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (module && e.key === "ArrowRight") presentation.go(index + 1, n); if (module && e.key === "ArrowLeft") presentation.go(index - 1, n);
    };
    window.addEventListener("keydown", onKey); document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, module, index, n]);
  if (!open) return null;
  const ready = step ? stepReady(step, avail) : { ready: true, missing: "" };
  return (
    <div className="present" role="dialog" aria-modal="true" aria-label="Presentation mode" ref={ref} tabIndex={-1} data-module={module ?? undefined}>
      <header className="present-head"><span className="row"><Presentation size={18} aria-hidden="true" /> <b>Presentation Mode</b>{module && <span className="muted">· {module === "clearvoice" ? "ClearVoice" : "RoadSonic"}</span>}</span>
        {module && <span className="present-progress" role="status"><span className="mono">{progressLabel(index, n)}</span><span className="bar" aria-hidden="true"><i style={{ width: `${((index + 1) / n) * 100}%` }} /></span></span>}
        <span className="row"><button className="btn ghost" onClick={presentation.restart} disabled={!module}><RotateCcw size={14} /> Restart</button><button className="btn ghost" onClick={presentation.exit} aria-label="Exit presentation"><X size={14} /> Exit</button></span></header>
      {!module ? <main className="present-main"><h1>Choose a presentation</h1><div className="grid2">
        {(["clearvoice", "roadsonic"] as ModuleKey[]).map((m) => <button key={m} className="card filter-card" onClick={() => presentation.choose(m)}><b>{m === "clearvoice" ? "ClearVoice: analysis and filtering" : "RoadSonic: siren detection"}</b><span className="muted">9 guided steps with presenter notes. Uses your uploaded recording and results.</span></button>)}</div></main>
        : <AnimatePresence mode="wait"><motion.main key={`${module}-${index}`} className="present-main" tabIndex={0} aria-label="Presentation content" initial={reduced ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: -24 }} transition={{ duration: reduced ? 0 : 0.22 }}>
          <h1>{step.title}</h1><p className="lead">{step.simple}</p>
          <div className="present-grid"><div className="present-stage" aria-live="polite">{!ready.ready && <p className="muted" role="status">{ready.missing}</p>}{module === "clearvoice" ? <ClearVoiceStage step={step} /> : <RoadSonicStage step={step} />}</div>
            <aside className="present-say card" aria-label="What to say"><h2>What to say</h2><p>{step.say(facts)}</p></aside></div></motion.main></AnimatePresence>}
      {module && <footer className="present-foot"><button className="btn ghost" onClick={() => presentation.go(index - 1, n)} disabled={index === 0}><ArrowLeft size={16} /> Back</button>
        <span className="muted">Arrow keys to navigate · Esc to exit</span>
        {index < n - 1 ? <button className="btn" onClick={() => presentation.go(index + 1, n)}>Next <ArrowRight size={16} /></button> : <button className="btn" onClick={presentation.exit}>Finish</button>}</footer>}
    </div>
  );
}
