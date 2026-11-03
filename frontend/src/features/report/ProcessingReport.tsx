import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { call, isAborted, url } from "../../api";
import { SpectrumChart, WaveformChart } from "../../components/charts";
import { ErrorPanel } from "../../components/ui";
import { formatBytes } from "../../logic/format.ts";

const n = (v: unknown, d = 4) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : v == null ? "not available" : String(v));

/** Processing Report: rendered from GET /clearvoice/{job}/processing-report (the same data the PDF is built from). The charts reuse the result already loaded. */
export default function ProcessingReport({ jobId, result, fs }: { jobId: string; result: any; fs: number }) {
  const [rep, setRep] = useState<any>(null), [err, setErr] = useState(""), [tries, setTries] = useState(0);
  useEffect(() => {
    const ctl = new AbortController(); setRep(null); setErr("");
    call(`/api/v1/clearvoice/${jobId}/processing-report`, { signal: ctl.signal }).then(setRep).catch((e) => { if (!isAborted(e)) setErr(e.message); });
    return () => ctl.abort();
  }, [jobId, tries]);
  const dl = (q: string) => url(`/api/v1/clearvoice/${jobId}/report?format=${q}`);
  return (
    <section className="card stack report" aria-labelledby="report-h">
      <div className="row"><FileText size={20} aria-hidden="true" /><h2 id="report-h" style={{ margin: 0 }}>Processing Report</h2></div>
      {err && <ErrorPanel message={err} onRetry={() => setTries((t) => t + 1)} hint="The result may have expired on the server; apply the filter again." />}
      {!rep && !err && <p className="muted" role="status">Building the report from your results…</p>}
      {rep && <>
        <p className="muted">Generated {rep.generated} · {rep.software.app} {rep.software.app_version} · engine {rep.software.engine}. Every value below was measured or taken from your actual settings.</p>
        <h3>1. Recording information</h3>
        <dl className="meta-grid">
          <div><dt>Original filename</dt><dd>{rep.recording.filename}</dd></div><div><dt>Sample rate</dt><dd>{n(rep.recording.sample_rate_hz)} Hz</dd></div><div><dt>Channels</dt><dd>{rep.recording.channels}</dd></div>
          <div><dt>Duration</dt><dd>{n(rep.recording.duration_s, 6)} s</dd></div><div className={rep.recording.file_size_bytes == null ? "unknown" : ""}><dt>File size</dt><dd>{rep.recording.file_size_bytes == null ? "not calculated" : formatBytes(rep.recording.file_size_bytes)}</dd></div></dl>
        <h3>2. Audio analysis</h3>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Channel</th><th>RMS</th><th>Peak amplitude</th><th>Mean amplitude</th></tr></thead>
          <tbody>{rep.analysis.channels.map((c: any) => <tr key={c.channel}><td>{c.channel}</td><td>{n(c.rms)}</td><td>{n(c.peak)}</td><td>{n(c.mean)}</td></tr>)}</tbody></table></div>
        <p>{rep.analysis.dominant_peaks_original.length ? <>Dominant frequency components (channel 0): {rep.analysis.dominant_peaks_original.map((p: any) => `${n(p.frequency_hz, 6)} Hz`).join(", ")}.</> : "No clear spectral peak was found."} <span className="muted">{rep.analysis.frequency_note}</span></p>
        <h3>3. Processing information</h3>
        <dl className="meta-grid"><div><dt>Processing</dt><dd>{rep.processing.kind === "voice" ? "Voice-enhancement pipeline" : "Digital filter"}</dd></div>
          {rep.processing.kind !== "voice" && <><div><dt>Filter type</dt><dd>{rep.processing.config.filter_type}</dd></div><div><dt>Cutoff frequencies</dt><dd>{rep.processing.config.cutoff_hz.join(", ")} Hz</dd></div><div><dt>Filter order</dt><dd>{rep.processing.config.order}</dd></div>
            <div><dt>Method</dt><dd>{rep.processing.config.method === "zero_phase" ? "zero-phase (forward-backward)" : "causal (single pass)"}</dd></div></>}
          <div><dt>Noise reduction</dt><dd>{rep.processing.noise_reduction.applied ? "applied" : "not applied"}</dd></div><div><dt>Processing duration</dt><dd>{rep.processing.processing_s == null ? "not recorded" : `${rep.processing.processing_s.toFixed(3)} s`}</dd></div></dl>
        {rep.processing.noise_reduction.applied ? <p className="mono">{JSON.stringify(rep.processing.noise_reduction.settings)}</p> : <p className="muted">{rep.processing.noise_reduction.note}</p>}
        <h3>4. Before and after comparison</h3>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Ch</th><th>RMS before → after</th><th>Peak before → after</th><th>Clipped samples before → after</th></tr></thead>
          <tbody>{rep.comparison.per_channel.map((c: any) => <tr key={c.channel}><td>{c.channel}</td><td>{n(c.rms_before)} → {n(c.rms_after)}</td><td>{n(c.peak_before)} → {n(c.peak_after)}</td><td>{c.clipped_before} → {c.clipped_after}</td></tr>)}</tbody></table></div>
        {rep.comparison.notes.map((t: string, i: number) => <p key={i} className="muted">{t}</p>)}
        <WaveformChart original={result.waveform_original} filtered={result.waveform_filtered} title="Report: original vs processed waveform" />
        <SpectrumChart xmax={Math.min(fs / 2, 8000)} title="Report: original vs processed spectrum" spectra={[{ name: "original", ...result.spectrum_original }, { name: "processed", ...result.spectrum_filtered }]} />
        <h3>5. Processing explanation</h3><p>{rep.explanation}</p>
        <h3>6. Limitations</h3><ul>{rep.limitations.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
        <h3>Reproducibility</h3><p className="muted">{rep.reproducibility.note} Software: Python {rep.software.python}, NumPy {rep.software.numpy}, SciPy {rep.software.scipy}, {rep.software.app} {rep.software.app_version}.</p>
        <div className="actions"><a className="btn" href={dl("pdf")}>Download PDF report</a><a className="btn ghost" href={dl("summary")}>Download processing summary</a><a className="btn ghost" href={dl("html")}>HTML report</a>
          <a className="btn ghost" href={url(`/api/v1/clearvoice/${jobId}/download`)}>Processed WAV</a></div>
      </>}
    </section>
  );
}
