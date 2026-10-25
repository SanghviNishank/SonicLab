import { useEffect } from "react";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import { SpectrumChart } from "../../components/charts";
import { ErrorPanel, ProcessingStatus, Skeleton } from "../../components/ui";
import { useMarkLoaded, useSession } from "../../context/Session";
import { useAnalysis } from "./useAnalysis";

export default function FrequencyStep() {
  const { cv } = useSession(), up = cv.upload, { analysis, params, run, busy, error } = useAnalysis(), fs = up.metadata.sample_rate_hz;
  useEffect(() => { if (!analysis) run(params); }, []);       // eslint-disable-line react-hooks/exhaustive-deps
  useMarkLoaded("clearvoice", "frequency-analysis", !!analysis?.spectrum);
  const sp = analysis?.spectrum;
  return (
    <WorkflowShell module="clearvoice" step="frequency-analysis" title="Frequency-domain analysis" intro="The Discrete Fourier Transform expresses the signal as a sum of sinusoids. Peaks show where energy concentrates; they do not by themselves identify a sound source.">
      <section className="card"><div className="form">
        <label>Channel<select value={params.channel} onChange={(e) => run({ ...params, channel: Number(e.target.value) })}>{Array.from({ length: up.metadata.channels }, (_, i) => <option key={i} value={i}>Channel {i}</option>)}</select></label>
        <label>Window<select value={params.window} onChange={(e) => run({ ...params, window: e.target.value as any })}><option value="hann">Hann (less leakage)</option><option value="rect">Rectangular</option></select></label></div>
        {busy && <ProcessingStatus label="Computing the FFT on the server…" />}{error && <ErrorPanel message={error} onRetry={() => run(params)} />}</section>
      {!sp && !error && <Skeleton h={320} />}
      {sp && <>
        <SpectrumChart xmax={Math.min(fs / 2, 8000)} spectra={[{ name: sp.window, freqs_hz: sp.freqs_hz, amplitude: sp.amplitude }, ...(analysis.spectrum_other_window ? [{ name: analysis.spectrum_other_window.window, freqs_hz: analysis.spectrum_other_window.freqs_hz, amplitude: analysis.spectrum_other_window.amplitude }] : [])]}
          note={`Engine: ${analysis.engine}. Amplitude is the single-sided peak amplitude (DC and Nyquist not doubled), corrected for the window's coherent gain.`} />
        <section className="card"><div className="tiles"><div className="tile"><b>{sp.bin_spacing_hz.toFixed(4)} Hz</b><span>Bin spacing fs/N</span></div><div className="tile"><b>{sp.nominal_resolution_hz.toFixed(4)} Hz</b><span>Nominal resolution</span></div>
          <div className="tile"><b>{(fs / 2).toLocaleString()} Hz</b><span>Nyquist fs/2</span></div><div className="tile"><b>{sp.n_fft.toLocaleString()}</b><span>FFT length</span></div></div>
          <h3 style={{ marginTop: "1rem" }}>Dominant spectral peaks (estimates)</h3>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Frequency (Hz)</th><th>Amplitude</th></tr></thead><tbody>{sp.peaks.map((p: any, i: number) => <tr key={i}><td>{i + 1}</td><td>{p.frequency_hz.toFixed(2)}</td><td>{p.amplitude.toFixed(5)}</td></tr>)}</tbody></table></div>
          {sp.peaks.length === 0 && <p className="muted">No clear peak: the signal may be silent or noise-like.</p>}</section>
        <section className="card"><h3>The math</h3><p className="eq">X[k] = Σₙ x[n] · exp(−j2πkn/N), &nbsp; f_k = k·fs/N, &nbsp; Δf = fs/N</p>
          <p className="muted">Zero-padding makes the plotted curve smoother but does not add real resolution; that is set by how long the signal is observed. Windowing trades leakage for width: compare Hann and rectangular above.</p></section></>}
    </WorkflowShell>
  );
}
