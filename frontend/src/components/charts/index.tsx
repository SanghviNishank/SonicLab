import Plot from "../Plot";
import { chartColors } from "./colors";
import { classifyResponse, describeRegions } from "../../logic/filterRegions.ts";

export function WaveformChart({ original, filtered, title = "Waveform", onRange, onClick, layout, note }: { original: any; filtered?: any; title?: string; onRange?: (r: [number, number] | null) => void; onClick?: (x: number) => void; layout?: any; note?: string }) {
  const c = chartColors();
  const tr = (w: any, name: string, color: string, opacity = 1) => w.channels.map((ch: any, i: number) => ({ x: ch.t, y: ch.y, type: "scatter", mode: "lines", name: `${name} ch${i}`, line: { width: 1, color: i === 0 ? color : c.c2 }, opacity }));
  return <Plot title={title} note={note ?? "Display decimated with min/max preserved; all analysis uses every sample."} onRange={onRange} onClick={onClick}
    data={[...tr(original, filtered ? "original" : "signal", c.c1), ...(filtered ? tr(filtered, "filtered", c.c3, 0.85) : [])]}
    layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Amplitude (full scale = 1)" }, ...layout }} />;
}

/** Log axis floor: 100 dB below the global maximum, so that exact-zero bins or numerical dust do not stretch the axis over 300 dB. */
function logRange(spectra: { amplitude: number[] }[]): [number, number] | undefined {
  let mx = 0; for (const s of spectra) for (const v of s.amplitude) if (v > mx) mx = v;
  return mx > 0 ? [Math.log10(mx) - 5, Math.log10(mx) + 0.2] : undefined;
}

export function SpectrumChart({ spectra, title = "Single-sided amplitude spectrum", xmax, note }: { spectra: { name: string; freqs_hz: number[]; amplitude: number[] }[]; title?: string; xmax?: number; note?: string }) {
  const c = chartColors(), cols = [c.c1, c.c3, c.c2];
  return <Plot title={title} note={note} data={spectra.map((s, i) => ({ x: s.freqs_hz, y: s.amplitude, type: "scatter", mode: "lines", name: s.name, line: { width: 1.2, color: cols[i % 3] } }))}
    layout={{ xaxis: { title: "Frequency (Hz)", range: xmax ? [0, xmax] : undefined }, yaxis: { title: "Amplitude (log scale)", type: "log", range: logRange(spectra) } }} />;
}

export function SpectrogramChart({ sg, title = "Spectrogram", fmax, shapes, onClick, height = 360 }: { sg: any; title?: string; fmax?: number; shapes?: any[]; onClick?: (x: number) => void; height?: number }) {
  return <Plot title={title} height={height} onClick={onClick} note={`Colour = dB relative to full scale, clipped to [-100, 0] dB · frame ${sg.frame_length} samples, hop ${sg.hop_length} samples${sg.reference ? ` · ${sg.reference}` : ""}`}
    data={[{ x: sg.times_s, y: sg.freqs_hz, z: sg.magnitude_db, type: "heatmap", zmin: -100, zmax: 0, colorscale: "Viridis", colorbar: { title: "dB" } }]}
    layout={{ shapes, xaxis: { title: "Time (s)" }, yaxis: { title: "Frequency (Hz)", range: fmax ? [0, fmax] : undefined } }} />;
}

const REGION_FILL = { pass: "rgba(74,222,128,0.12)", transition: "rgba(255,176,32,0.12)", stop: "rgba(248,113,113,0.12)" } as const;
const REGION_LABEL = { pass: "passband", transition: "transition", stop: "stopband" } as const;

export function FilterResponseChart({ response, cutoffs, title = "Filter frequency response", fs }: { response: any; cutoffs: number[]; title?: string; fs?: number }) {
  const c = chartColors();
  const zero = /zero|forward/i.test(String(response.effective));
  const regions = classifyResponse(response.freqs_hz, response.magnitude_db, zero ? -6 : -3, -40);
  const hasPhase = Array.isArray(response.phase_deg) && response.phase_deg.length === response.freqs_hz.length && !zero;
  const unwrapped = hasPhase ? unwrapDeg(response.phase_deg) : [];
  return <>
    <Plot title={title} summary={`Regions measured from this response: ${describeRegions(regions)}.`}
      note={`Theoretical magnitude response (${response.effective}). Shading: green passband (≥ ${zero ? -6 : -3} dB), amber transition, red stopband (≤ −40 dB); dotted lines mark the cutoff(s). This is the filter, not the spectrum of your recording.`}
      data={[{ x: response.freqs_hz, y: response.magnitude_db, type: "scatter", mode: "lines", name: "|H| (dB)", line: { color: c.c2, width: 2 } }]}
      layout={{ margin: { l: 55, r: 15, t: 26, b: 45 }, xaxis: { title: "Frequency (Hz)", range: fs ? [0, fs / 2] : undefined }, yaxis: { title: "Magnitude (dB)", range: [-80, 5] },
        shapes: [...regions.map((r) => ({ type: "rect", xref: "x", yref: "paper", x0: r.f0, x1: r.f1, y0: 0, y1: 1, fillcolor: REGION_FILL[r.kind], line: { width: 0 }, layer: "below" })),
          ...cutoffs.map((f) => ({ type: "line", x0: f, x1: f, yref: "paper", y0: 0, y1: 1, line: { color: c.event, width: 1.5, dash: "dot" } }))],
        annotations: [...regions.filter((r) => (r.f1 - r.f0) > (fs ?? response.freqs_hz[response.freqs_hz.length - 1]) / 2 * 0.15).map((r) => ({ x: (r.f0 + r.f1) / 2, y: 1, yref: "paper", yanchor: "bottom", text: REGION_LABEL[r.kind], showarrow: false, font: { size: 10 } })),
          ...cutoffs.map((f) => ({ x: f, y: 0.02, yref: "paper", text: `${f} Hz`, showarrow: false, xanchor: "left", font: { size: 10, color: c.event } }))] }} />
    {hasPhase ? <Plot title="Filter phase response" height={240} summary="Unwrapped phase of the causal filter."
      note={response.phase_note ?? "Unwrapped phase of the causal filter. A non-linear phase delays frequencies by different amounts."}
      data={[{ x: response.freqs_hz, y: unwrapped, type: "scatter", mode: "lines", name: "phase (°)", line: { color: c.c3, width: 2 } }]}
      layout={{ xaxis: { title: "Frequency (Hz)", range: fs ? [0, fs / 2] : undefined }, yaxis: { title: "Phase (degrees)" } }} />
      : zero && <section className="card"><p className="muted">{response.phase_note ?? "Zero-phase (forward-backward) filtering has exactly zero phase response, so no phase chart is shown."}</p></section>}
  </>;
}

function unwrapDeg(p: number[]): number[] {
  const out = [p[0]]; let off = 0;
  for (let i = 1; i < p.length; i++) { const d = p[i] - p[i - 1]; if (d > 180) off -= 360; else if (d < -180) off += 360; out.push(p[i] + off); }
  return out;
}
