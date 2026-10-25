import { useEffect } from "react";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import { SpectrogramChart } from "../../components/charts";
import { ErrorPanel, ProcessingStatus, Skeleton } from "../../components/ui";
import { useMarkLoaded, useSession } from "../../context/Session";
import { useAnalysis } from "./useAnalysis";

export default function SpectrogramStep() {
  const { cv } = useSession(), up = cv.upload, { analysis, params, run, busy, error } = useAnalysis(), fs = up.metadata.sample_rate_hz;
  useEffect(() => { if (!analysis) run(params); }, []);       // eslint-disable-line react-hooks/exhaustive-deps
  useMarkLoaded("clearvoice", "spectrogram", !!analysis?.spectrogram);
  const sg = analysis?.spectrogram, L = params.frame_length;
  return (
    <WorkflowShell module="clearvoice" step="spectrogram" title="Spectrogram" intro="The short-time Fourier transform slices the signal into overlapping frames and takes an FFT of each, showing how frequency content changes over time.">
      <section className="card"><div className="form">
        <label>Frame length (samples)<select value={L} onChange={(e) => run({ ...params, frame_length: Number(e.target.value), hop_length: null })}>{[256, 512, 1024, 2048, 4096].map((n) => <option key={n} value={n}>{n} ({(1000 * n / fs).toFixed(1)} ms)</option>)}</select></label>
        <label>Hop<select value={params.hop_length ?? "auto"} onChange={(e) => run({ ...params, hop_length: e.target.value === "auto" ? null : Number(e.target.value) })}><option value="auto">Auto (frame/4)</option><option value={L / 2}>{L / 2} (50 % overlap)</option><option value={L}>{L} (no overlap)</option></select></label>
        <label>Window<select value={params.window} onChange={(e) => run({ ...params, window: e.target.value as any })}><option value="hann">Hann</option><option value="rect">Rectangular</option></select></label></div>
        {busy && <ProcessingStatus label="Computing the spectrogram on the server…" />}{error && <ErrorPanel message={error} onRetry={() => run(params)} />}</section>
      {!sg && !error && <Skeleton h={360} />}
      {sg && <><SpectrogramChart sg={sg} fmax={Math.min(fs / 2, 8000)} height={420} />
        <section className="card"><h3>How to read it</h3><p className="eq">X_m[k] = Σₙ x[n + mH] · w[n] · exp(−j2πkn/L)</p>
          <p className="muted">Horizontal axis: time of each frame centre. Vertical axis: frequency. Colour: level in dB relative to a full-scale sinusoid. A long frame resolves frequency better but blurs fast changes; a short frame does the opposite. The plot is decimated for display; the exported spectrogram CSV uses the full matrix.</p></section></>}
    </WorkflowShell>
  );
}
