import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Plot from "../../components/Plot";
import { SpectrogramChart, SpectrumChart } from "../../components/charts";
import { chartColors } from "../../components/charts/colors";
import { add, aliasFrequency, amplitudeSpectrum, isAliased, sine } from "../../logic/dspDemo.ts";

const SYN = "Synthetic demonstration signal generated in your browser. It is not your recording.";

export function SineExperiment() {
  const [f1, setF1] = useState(440), [a1, setA1] = useState(0.5), [two, setTwo] = useState(false), [f2, setF2] = useState(1200), [a2, setA2] = useState(0.3);
  const FS = 8000, N = 2048, c = chartColors();
  const { x, sp } = useMemo(() => { const base = sine(f1, a1, FS, N), x = two ? add(base, sine(f2, a2, FS, N)) : base; return { x, sp: amplitudeSpectrum(x, FS) }; }, [f1, a1, two, f2, a2]);
  const show = 240;                                                                  // 30 ms
  return (
    <div className="stack"><p className="muted">{SYN} Sampling rate {FS} Hz.</p>
      <div className="form">
        <label>Frequency 1: {f1} Hz<input type="range" min={50} max={3500} value={f1} onChange={(e) => setF1(+e.target.value)} /></label>
        <label>Amplitude 1: {a1.toFixed(2)}<input type="range" min={0.05} max={0.9} step={0.05} value={a1} onChange={(e) => setA1(+e.target.value)} /></label>
        <label className="inline"><input type="checkbox" checked={two} onChange={(e) => setTwo(e.target.checked)} /> Add a second sine wave</label>
        {two && <><label>Frequency 2: {f2} Hz<input type="range" min={50} max={3500} value={f2} onChange={(e) => setF2(+e.target.value)} /></label>
          <label>Amplitude 2: {a2.toFixed(2)}<input type="range" min={0.05} max={0.9} step={0.05} value={a2} onChange={(e) => setA2(+e.target.value)} /></label></>}</div>
      <Plot title="Time domain (first 30 ms)" height={220} summary={`Sine wave${two ? " sum" : ""}, ${f1} Hz${two ? ` plus ${f2} Hz` : ""}.`}
        data={[{ x: Array.from({ length: show }, (_, i) => (1000 * i) / FS), y: Array.from(x.slice(0, show)), type: "scatter", mode: "lines", line: { color: c.c1, width: 2 } }]} layout={{ xaxis: { title: "Time (ms)" }, yaxis: { title: "Amplitude", range: [-1.2, 1.2] } }} />
      <Plot title="Spectrum (FFT) of the same signal" height={220} note={two ? "Two separate peaks: the FFT reveals the two sine waves hidden in the sum." : "One peak at the sine frequency."}
        data={[{ x: sp.freqs, y: sp.amp, type: "scatter", mode: "lines", line: { color: c.c3, width: 2 } }]} layout={{ xaxis: { title: "Frequency (Hz)" }, yaxis: { title: "Amplitude" } }} /></div>
  );
}

export function SamplingExperiment() {
  const [f, setF] = useState(300), [fs, setFs] = useState(1000), c = chartColors(), windowS = 0.03;
  const alias = aliasFrequency(f, fs), bad = isAliased(f, fs);
  const dense = useMemo(() => { const n = 600; return { t: Array.from({ length: n }, (_, i) => (i / n) * windowS * 1000), y: Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * (i / n) * windowS)) }; }, [f]);
  const pts = useMemo(() => { const n = Math.floor(windowS * fs); return { t: Array.from({ length: n }, (_, i) => (1000 * i) / fs), y: Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i / fs)) }; }, [f, fs]);
  const rec = useMemo(() => { const n = 600; return { t: Array.from({ length: n }, (_, i) => (i / n) * windowS * 1000), y: Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * alias * (i / n) * windowS)) }; }, [alias]);
  return (
    <div className="stack"><p className="muted">{SYN}</p>
      <div className="form"><label>Signal frequency: {f} Hz<input type="range" min={50} max={3000} value={f} onChange={(e) => setF(+e.target.value)} /></label>
        <label>Sampling rate<select value={fs} onChange={(e) => setFs(+e.target.value)}>{[500, 1000, 2000, 4000, 8000].map((v) => <option key={v} value={v}>{v} Hz</option>)}</select></label></div>
      <p className={bad ? "warn" : "ok"} role="status">Nyquist frequency = {fs / 2} Hz. {bad ? `⚠ ${f} Hz is above Nyquist: after sampling it appears as ${alias} Hz (aliasing).` : `${f} Hz is below Nyquist, so it is captured correctly.`}</p>
      <Plot title="Continuous sine and its samples (30 ms)" height={240} summary={`Signal ${f} Hz sampled at ${fs} Hz.`}
        data={[{ x: dense.t, y: dense.y, type: "scatter", mode: "lines", name: "original sound", line: { color: c.c1, width: 1.5 } }, { x: pts.t, y: pts.y, type: "scatter", mode: "markers", name: "samples", marker: { color: c.event, size: 7 } },
          ...(bad ? [{ x: rec.t, y: rec.y, type: "scatter", mode: "lines", name: `what the samples look like (${alias} Hz)`, line: { color: "#ff5d73", width: 1.5, dash: "dot" } }] : [])]}
        layout={{ xaxis: { title: "Time (ms)" }, yaxis: { title: "Amplitude", range: [-1.3, 1.3] } }} /></div>
  );
}

export function RealFilterExperiment({ cv }: { cv: any }) {
  const r = cv?.filter?.result, fs = cv?.upload?.metadata?.sample_rate_hz;
  if (!r) return <div className="empty"><p><b>Your recording has not been filtered yet.</b></p><p className="muted">Upload a recording and apply a filter in ClearVoice; this experiment then compares the real spectrum before and after.</p><Link className="btn" to={cv?.upload ? "/clearvoice/filter" : "/clearvoice/upload"}>{cv?.upload ? "Open the Visual Filter Lab" : "Upload a recording"}</Link></div>;
  return <div className="stack"><p className="muted">Your actual recording, processed by the backend: {cv.filter.label}.</p>
    <SpectrumChart xmax={Math.min(fs / 2, 8000)} title="FFT before and after filtering (your recording)" spectra={[{ name: "original", ...r.spectrum_original }, { name: "processed", ...r.spectrum_filtered }]} />
    <p className="muted">Change the cutoff in the <Link to="/clearvoice/filter">Visual Filter Lab</Link> and apply it again to see this graph change.</p></div>;
}

export function RealSpectrogramExperiment({ cv }: { cv: any }) {
  const r = cv?.filter?.result, fs = cv?.upload?.metadata?.sample_rate_hz;
  if (!r) return <div className="empty"><p><b>No processed result yet.</b></p><p className="muted">Apply a filter in ClearVoice to compare your recording's spectrogram before and after.</p><Link className="btn" to={cv?.upload ? "/clearvoice/filter" : "/clearvoice/upload"}>{cv?.upload ? "Open the Visual Filter Lab" : "Upload a recording"}</Link></div>;
  return <div className="grid2"><SpectrogramChart sg={r.spectrogram_original} title="Spectrogram - original" fmax={Math.min(fs / 2, 8000)} height={280} /><SpectrogramChart sg={r.spectrogram_filtered} title="Spectrogram - processed" fmax={Math.min(fs / 2, 8000)} height={280} /></div>;
}

export function RealSpectrumExperiment({ cv, rs }: { cv: any; rs: any }) {
  const sp = cv?.analysis?.spectrum ?? rs?.res?.spectrum, fs = (cv?.upload ?? rs?.upload)?.metadata?.sample_rate_hz;
  if (!sp) return <div><div className="empty"><p><b>Your recording's spectrum has not been computed yet.</b></p><p className="muted">Upload a recording and open its frequency analysis. Meanwhile, here is a synthetic demonstration:</p></div><SineExperiment /></div>;
  return <div className="stack"><p className="muted">Your actual recording's spectrum from the backend.</p><SpectrumChart xmax={Math.min(fs / 2, 8000)} spectra={[{ name: sp.window ?? "spectrum", freqs_hz: sp.freqs_hz, amplitude: sp.amplitude }]} /></div>;
}
