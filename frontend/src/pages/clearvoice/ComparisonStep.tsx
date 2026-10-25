import WorkflowShell from "../../components/workflow/WorkflowShell";
import ABPlayer from "../../components/audio/ABPlayer";
import { FilterResponseChart, SpectrogramChart, SpectrumChart, WaveformChart } from "../../components/charts";
import { useMarkLoaded, useSession } from "../../context/Session";
import { url } from "../../api";

export default function ComparisonStep() {
  const { cv } = useSession(), up = cv.upload, r = cv.filter.result, id = up.metadata.audio_id, fs = up.metadata.sample_rate_hz;
  useMarkLoaded("clearvoice", "comparison", !!r);
  return (
    <WorkflowShell module="clearvoice" step="comparison" title="Original versus processed" nextLabel="Results and export" intro={`Processed with: ${cv.filter.label}.`}>
      <section className="card"><h3>Listen: A/B</h3><ABPlayer a={{ label: "Original", src: url(`/api/v1/audio/${id}/file`) }} b={{ label: "Processed", src: url(`/api/v1/clearvoice/${r.job_id}/download`) }} /></section>
      <WaveformChart original={r.waveform_original} filtered={r.waveform_filtered} title="Waveform: original vs processed" />
      <SpectrumChart xmax={Math.min(fs / 2, 8000)} title="Spectrum: original vs processed (same axes)" spectra={[{ name: "original", ...r.spectrum_original }, { name: "processed", ...r.spectrum_filtered }]} />
      {r.response && <FilterResponseChart response={r.response} cutoffs={r.config.cutoff_hz ?? []} fs={fs} />}
      <div className="grid2"><SpectrogramChart sg={r.spectrogram_original} title="Spectrogram - original" fmax={Math.min(fs / 2, 8000)} height={300} /><SpectrogramChart sg={r.spectrogram_filtered} title="Spectrogram - processed" fmax={Math.min(fs / 2, 8000)} height={300} /></div>
      <section className="card stack"><h3>Measured signal change</h3>
        <div className="table-wrap"><table><thead><tr><th>Ch</th><th>RMS before</th><th>RMS after</th><th>Change (dB)</th><th>MSE</th></tr></thead><tbody>
          {r.metrics.per_channel.map((m: any, i: number) => <tr key={i}><td>{i}</td><td>{m.rms_before.toFixed(5)}</td><td>{m.rms_after.toFixed(5)}</td><td>{m.rms_change_db == null ? "—" : m.rms_change_db.toFixed(2)}</td><td>{m.mse.toExponential(3)}</td></tr>)}</tbody></table></div>
        <p className="muted">{r.metrics.note} A lower RMS does not mean noise was removed, and no SNR is shown because there is no clean reference recording.</p>
        {r.warnings?.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}</section>
      {r.history && <section className="card"><h3>Processing history</h3><div className="table-wrap"><table><thead><tr><th>Stage</th><th>Peak</th><th>RMS</th></tr></thead><tbody>{r.history.map((h: any, i: number) => <tr key={i}><td>{h.stage}</td><td>{h.peak.toFixed(3)}</td><td>{h.rms.toFixed(4)}</td></tr>)}</tbody></table></div></section>}
    </WorkflowShell>
  );
}
