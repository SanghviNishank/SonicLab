import { useMemo, useState } from "react";
import Plot from "../Plot";
import { DEMO_EVENTS, DEMO_FS, butterworthLowpassDb, demoChirp, demoSpectrogram, demoSpectrum } from "../../logic/demoSignal.ts";

const TABS = ["Waveform", "Spectrum", "Spectrogram", "Filter response", "Event timeline"] as const;
export default function FeaturePreview() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Waveform");
  const sig = useMemo(() => demoChirp(2), []), sp = useMemo(() => demoSpectrum(sig.y.slice(4000, 5024)), [sig]), sg = useMemo(() => demoSpectrogram(sig.y), [sig]);
  const fr = useMemo(() => { const f = Array.from({ length: 400 }, (_, i) => (i * DEMO_FS) / 2 / 399); return { f, db: butterworthLowpassDb(f, 1000, 4) }; }, []);
  const common = { height: 300 };
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Preview">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Waveform" && <Plot title="Waveform" {...common} data={[{ x: sig.t, y: sig.y, type: "scatter", mode: "lines", line: { width: 1 } }]} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Amplitude" } }} />}
      {tab === "Spectrum" && <Plot title="Single-sided amplitude spectrum" {...common} data={[{ x: sp.f, y: sp.a, type: "scatter", mode: "lines" }]} layout={{ xaxis: { title: "Frequency (Hz)" }, yaxis: { title: "Amplitude", type: "log" } }} />}
      {tab === "Spectrogram" && <Plot title="Spectrogram" {...common} data={[{ x: sg.t, y: sg.f, z: sg.z, type: "heatmap", zmin: -90, zmax: 0, colorscale: "Viridis" }]} layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Frequency (Hz)" } }} />}
      {tab === "Filter response" && <Plot title="4th-order Butterworth low-pass, fc = 1 kHz" {...common} data={[{ x: fr.f, y: fr.db, type: "scatter", mode: "lines" }]} layout={{ xaxis: { title: "Frequency (Hz)" }, yaxis: { title: "Magnitude (dB)", range: [-60, 3] } }} />}
      {tab === "Event timeline" && <Plot title="Candidate-event timeline (illustrative)" {...common} data={[{ x: sig.t, y: sig.y, type: "scatter", mode: "lines", line: { width: 1 } }]}
        layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Amplitude" }, shapes: DEMO_EVENTS.map((e) => ({ type: "rect", xref: "x", yref: "paper", x0: e.start, x1: e.end, y0: 0, y1: 1, fillcolor: "rgba(255,176,32,.2)", line: { color: "#ffb020", dash: "dot" } })), annotations: DEMO_EVENTS.map((e) => ({ x: (e.start + e.end) / 2, y: 1, yref: "paper", text: e.label, showarrow: false, yanchor: "bottom" })) }} />}
      <p className="muted">Illustrative synthetic signal (a 400–1400 Hz sweep plus 60 Hz hum) generated in your browser. This is not an analysis of any recording; the workspaces replace it with your real results.</p>
    </div>
  );
}
