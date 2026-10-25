import Plot from "../Plot";
import { chartColors } from "./colors";

export function WaveformChart({ original, filtered, title = "Waveform", onRange, onClick, layout, note }: { original: any; filtered?: any; title?: string; onRange?: (r: [number, number] | null) => void; onClick?: (x: number) => void; layout?: any; note?: string }) {
  const c = chartColors();
  const tr = (w: any, name: string, color: string, opacity = 1) => w.channels.map((ch: any, i: number) => ({ x: ch.t, y: ch.y, type: "scatter", mode: "lines", name: `${name} ch${i}`, line: { width: 1, color: i === 0 ? color : c.c2 }, opacity }));
  return <Plot title={title} note={note ?? "Display decimated with min/max preserved; all analysis uses every sample."} onRange={onRange} onClick={onClick}
    data={[...tr(original, filtered ? "original" : "signal", c.c1), ...(filtered ? tr(filtered, "filtered", c.c3, 0.85) : [])]}
    layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Amplitude (full scale = 1)" }, ...layout }} />;
}

export function SpectrumChart({ spectra, title = "Single-sided amplitude spectrum", xmax, note }: { spectra: { name: string; freqs_hz: number[]; amplitude: number[] }[]; title?: string; xmax?: number; note?: string }) {
  const c = chartColors(), cols = [c.c1, c.c3, c.c2];
  return <Plot title={title} note={note} data={spectra.map((s, i) => ({ x: s.freqs_hz, y: s.amplitude, type: "scatter", mode: "lines", name: s.name, line: { width: 1.2, color: cols[i % 3] } }))}
    layout={{ xaxis: { title: "Frequency (Hz)", range: xmax ? [0, xmax] : undefined }, yaxis: { title: "Amplitude (full scale = 1)", type: "log" } }} />;
}

export function SpectrogramChart({ sg, title = "Spectrogram", fmax, shapes, onClick, height = 360 }: { sg: any; title?: string; fmax?: number; shapes?: any[]; onClick?: (x: number) => void; height?: number }) {
  return <Plot title={title} height={height} onClick={onClick} note={`dB re full-scale single-sided amplitude · frame ${sg.frame_length}, hop ${sg.hop_length} · ${sg.reference ?? ""}`}
    data={[{ x: sg.times_s, y: sg.freqs_hz, z: sg.magnitude_db, type: "heatmap", zmin: -100, zmax: 0, colorscale: "Viridis", colorbar: { title: "dB" } }]}
    layout={{ shapes, xaxis: { title: "Time (s)" }, yaxis: { title: "Frequency (Hz)", range: fmax ? [0, fmax] : undefined } }} />;
}

export function FilterResponseChart({ response, cutoffs, title = "Filter frequency response", fs }: { response: any; cutoffs: number[]; title?: string; fs?: number }) {
  const c = chartColors();
  return <Plot title={title} note={`Theoretical magnitude response (${response.effective}). This is the filter, not the spectrum of your recording.`}
    data={[{ x: response.freqs_hz, y: response.magnitude_db, type: "scatter", mode: "lines", name: "|H| (dB)", line: { color: c.c2, width: 2 } }]}
    layout={{ xaxis: { title: "Frequency (Hz)", range: fs ? [0, fs / 2] : undefined }, yaxis: { title: "Magnitude (dB)", range: [-80, 5] },
      shapes: cutoffs.map((f) => ({ type: "line", x0: f, x1: f, yref: "paper", y0: 0, y1: 1, line: { color: c.event, width: 1.5, dash: "dot" } })) }} />;
}
