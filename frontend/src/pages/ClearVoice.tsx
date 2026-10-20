import { useState } from "react";
import Uploader from "../components/Uploader";
import Stats from "../components/Stats";
import Plot from "../components/Plot";
import { useEffect } from "react";
import { call, postJson, url } from "../api";

const wave = (w: any, name: string) => w.channels.map((c: any, i: number) => ({ x: c.t, y: c.y, type: "scatter", mode: "lines", name: `${name} ch${i}` }));

export default function ClearVoice() {
  const [up, setUp] = useState<any>(null);
  const [an, setAn] = useState<any>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [presets, setPresets] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState("lecture_speech");
  const [adv, setAdv] = useState({ on: false, method: "wiener", strength: 0.7, reduction: 18, gate: true, hp: 80 });
  const [f, setF] = useState({ filter_type: "lowpass", order: 4, lo: 1000, hi: 3000, method: "zero_phase" });
  useEffect(() => { call("/api/v1/clearvoice/presets").then((r) => setPresets(r.presets)).catch(() => {}); }, []);
  const id = up?.metadata.audio_id;
  const two = f.filter_type === "bandpass" || f.filter_type === "bandstop";

  async function run<T>(fn: () => Promise<T>) { setBusy(true); setErr(""); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const analyze = () => run(async () => setAn(await postJson(`/api/v1/clearvoice/${id}/analyze`, { window: "hann", compare_windows: true })));
  const filter = () => run(async () => setRes(await postJson(`/api/v1/clearvoice/${id}/filter`,
    { filter_type: f.filter_type, order: Number(f.order), cutoff_hz: two ? [Number(f.lo), Number(f.hi)] : [Number(f.lo)], method: f.method })));

  const voice = () => run(async () => {
    const overrides = adv.on ? {
      rumble: { enabled: true, cutoff_hz: Number(adv.hp), order: 4 }, dc_removal: { enabled: true },
      noise_reduction: { enabled: true, method: adv.method, strength: Number(adv.strength), max_reduction_db: Number(adv.reduction) },
      speech_gate: { enabled: adv.gate, attenuation_db: 10 } } : {};
    setRes(null);                                   // never show the previous result while a new one is computed
    setRes(await postJson(`/api/v1/clearvoice/${id}/voice`, { preset, overrides }));
  });
  const reset = () => { setRes(null); setAn(null); setErr(""); setAdv({ on: false, method: "wiener", strength: 0.7, reduction: 18, gate: true, hp: 80 }); setPreset("lecture_speech"); };

  return (
    <div className="stack">
      <h1>ClearVoice</h1>
      <Uploader onDone={(r) => { setUp(r); setAn(null); setRes(null); }} onClear={() => { setUp(null); setAn(null); setRes(null); }} />
      {err && <p className="error" role="alert">⚠ {err}</p>}
      {up && <>
        <Stats res={up} />
        <audio controls src={url(`/api/v1/audio/${id}/file`)} style={{ width: "100%" }} aria-label="Original audio" />
        <Plot title="Waveform (display-decimated, extrema preserved)" data={wave(up.waveform, "original")} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Amplitude (FS=1)" } }} />
        <section className="card"><h3>3 · Spectrum &amp; spectrogram</h3>
          <button className="btn" disabled={busy} onClick={analyze}>{busy ? "Working…" : "Analyze channel 0"}</button></section>
        {an && <>
          <Plot title="Single-sided amplitude spectrum (Hann vs rectangular)" data={[
            { x: an.spectrum.freqs_hz, y: an.spectrum.amplitude, type: "scatter", name: "hann" },
            { x: an.spectrum_other_window.freqs_hz, y: an.spectrum_other_window.amplitude, type: "scatter", name: "rect", opacity: 0.6 }]}
            layout={{ xaxis: { title: "Frequency (Hz)" }, yaxis: { title: "Amplitude (FS=1)", type: "log" } }} />
          <p className="muted">Bin spacing {an.spectrum.bin_spacing_hz.toFixed(3)} Hz · peaks: {an.spectrum.peaks.map((p: any) => p.frequency_hz.toFixed(1) + " Hz").join(", ") || "none"} (spectral-peak estimates)</p>
          <Plot title="Spectrogram (dB re full scale)" data={[{ x: an.spectrogram.times_s, y: an.spectrogram.freqs_hz, z: an.spectrogram.magnitude_db, type: "heatmap", zmin: -100, zmax: 0 }]}
            layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Frequency (Hz)" } }} /></>}
                <section className="card"><h3>4a · Voice enhancement</h3>
          <div className="form"><label>Preset<select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.keys(presets).map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></label></div>
          <p className="muted">{presets[preset] ?? "Loading presets…"}</p>
          <label className="inline"><input type="checkbox" checked={adv.on} onChange={(e) => setAdv({ ...adv, on: e.target.checked })} /> Advanced: override preset with these settings</label>
          {adv.on && <div className="form">
            <label>Noise-reduction method<select value={adv.method} onChange={(e) => setAdv({ ...adv, method: e.target.value })}>
              <option value="wiener">Adaptive Wiener (no noise-only section needed)</option><option value="gate">Spectral gate (uses quietest 10% of frames)</option></select></label>
            <label>Strength (0–1)<input type="number" step={0.1} min={0} max={1} value={adv.strength} onChange={(e) => setAdv({ ...adv, strength: +e.target.value })} /></label>
            <label>Max reduction (dB)<input type="number" min={1} max={40} value={adv.reduction} onChange={(e) => setAdv({ ...adv, reduction: +e.target.value })} /></label>
            <label>Rumble high-pass (Hz)<input type="number" min={20} max={400} value={adv.hp} onChange={(e) => setAdv({ ...adv, hp: +e.target.value })} /></label>
            <label className="inline"><input type="checkbox" checked={adv.gate} onChange={(e) => setAdv({ ...adv, gate: e.target.checked })} /> Attenuate non-speech intervals by 10 dB</label></div>}
          <p className="actions"><button className="btn" disabled={busy} onClick={voice}>{busy ? "Processing…" : "Run voice pipeline"}</button>
            <button className="btn ghost" disabled={busy} onClick={reset}>Reset</button></p>
          <p className="muted">These stages reduce steady or slowly varying noise. They cannot remove music or other talkers, and cannot identify one speaker.</p>
          <p className="muted">A filter is not a denoiser. Presets are fixed parameter sets, not guarantees; subjective speech quality is not verified.</p></section>
        <section className="card"><h3>4b · Digital filter</h3>
          <div className="form">
            <label>Type<select value={f.filter_type} onChange={(e) => setF({ ...f, filter_type: e.target.value })}>
              <option value="lowpass">Low-pass</option><option value="highpass">High-pass</option><option value="bandpass">Band-pass</option><option value="bandstop">Band-stop / notch</option></select></label>
            <label>Order (1–12)<input type="number" min={1} max={12} value={f.order} onChange={(e) => setF({ ...f, order: +e.target.value })} /></label>
            <label>{two ? "Low cutoff (Hz)" : "Cutoff (Hz)"}<input type="number" value={f.lo} onChange={(e) => setF({ ...f, lo: +e.target.value })} /></label>
            {two && <label>High cutoff (Hz)<input type="number" value={f.hi} onChange={(e) => setF({ ...f, hi: +e.target.value })} /></label>}
            <label>Method<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="zero_phase">Zero-phase (forward-backward, noncausal)</option><option value="causal">Causal (single pass, phase delay)</option></select></label>
          </div>
          <button className="btn" disabled={busy} onClick={filter}>{busy ? "Processing…" : "Apply filter"}</button>
          <p className="muted">Nyquist = {up.metadata.sample_rate_hz / 2} Hz. A filter also removes wanted content inside its stop band.</p>
        </section>
        {res && <>
          {res.warnings.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}
          {res.quality && <section className="card"><h3>Output quality checks</h3>
            <p className={res.quality.ok ? "muted" : "error"} role="status">{res.quality.ok ? "✔ checks passed" : "✖ checks failed"} · peak {res.quality.peak.toFixed(3)} · RMS {res.quality.rms.toFixed(4)} · clipped {res.quality.clipped_samples}</p>
            {res.quality.issues.map((m: string, i: number) => <p key={i} className="warn">⚠ {m}</p>)}
            <div className="table-wrap"><table><thead><tr><th>Stage</th><th>Peak</th><th>RMS</th></tr></thead><tbody>
              {res.history.map((h: any, i: number) => <tr key={i}><td>{h.stage}</td><td>{h.peak.toFixed(3)}</td><td>{h.rms.toFixed(4)}</td></tr>)}</tbody></table></div></section>}
          {res.response && <Plot title={`Filter response (${res.response.effective})`} data={[{ x: res.response.freqs_hz, y: res.response.magnitude_db, type: "scatter", name: "dB" }]}
            layout={{ xaxis: { title: "Frequency (Hz)" }, yaxis: { title: "Magnitude (dB)", range: [-80, 5] } }} />}
          <Plot title="Original vs filtered waveform" data={[...wave(res.waveform_original, "original"), ...wave(res.waveform_filtered, "filtered")]} layout={{ xaxis: { title: "Time (s)" } }} />
          <Plot title="Original vs filtered spectrum" data={[{ x: res.spectrum_original.freqs_hz, y: res.spectrum_original.amplitude, type: "scatter", name: "original" },
            { x: res.spectrum_filtered.freqs_hz, y: res.spectrum_filtered.amplitude, type: "scatter", name: "filtered" }]}
            layout={{ xaxis: { title: "Frequency (Hz)" }, yaxis: { type: "log", title: "Amplitude (FS=1)" } }} />
          <section className="card"><h3>5 · Compare &amp; export</h3>
            <div className="table-wrap"><table><thead><tr><th>Ch</th><th>RMS before</th><th>RMS after</th><th>MSE</th></tr></thead><tbody>
              {res.metrics.per_channel.map((m: any, i: number) => <tr key={i}><td>{i}</td><td>{m.rms_before.toFixed(5)}</td><td>{m.rms_after.toFixed(5)}</td><td>{m.mse.toExponential(3)}</td></tr>)}</tbody></table></div>
            <p className="muted">{res.metrics.note}</p>
            <audio key={res.job_id} controls src={url(`/api/v1/clearvoice/${res.job_id}/download`)} style={{ width: "100%" }} aria-label="Processed audio" />
            {res.processing_s != null && <p className="muted">Processed in {res.processing_s.toFixed(1)} s · job {res.job_id.slice(0, 8)}</p>}
            <p className="actions">
              <a className="btn" href={url(`/api/v1/clearvoice/${res.job_id}/download`)}>Filtered WAV</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/export?kind=metadata`)}>Settings JSON</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/download?subtype=pcm16`)}>WAV 16-bit</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/export?kind=history`)}>History JSON</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/export?kind=spectrogram_filtered`)}>Spectrogram CSV</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/export?kind=metrics`)}>Metrics CSV</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/report?format=html`)}>HTML report</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/report?format=pdf`)}>PDF report</a>
              <a className="btn ghost" href={url(`/api/v1/clearvoice/${res.job_id}/export?kind=spectrum_filtered`)}>Spectrum CSV</a></p>
            <p className="muted">{res.wav_format}</p></section></>}
      </>}
    </div>
  );
}
