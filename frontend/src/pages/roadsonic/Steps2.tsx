import { useState } from "react";
import { url } from "../../api";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import ABPlayer from "../../components/audio/ABPlayer";
import Plot from "../../components/Plot";
import { SpectrogramChart, WaveformChart } from "../../components/charts";
import { chartColors } from "../../components/charts/colors";
import { ErrorPanel, ProcessingStatus } from "../../components/ui";
import SettingsPanel from "../../features/roadsonic/SettingsPanel";
import { useMarkLoaded, useSession } from "../../context/Session";
import { useRoadSonic } from "./useRoadSonic";

export function PreprocessStep() {
  const { rs } = useSession(), { defaults, settings, setSettings, resetSettings, run, busy, error, dirty } = useRoadSonic(), r = rs.res, fs = r.summary.sample_rate_hz;
  useMarkLoaded("roadsonic", "preprocess", !!r);
  const act = r.preprocessing.active;
  return (
    <WorkflowShell module="roadsonic" step="preprocess" title="Optional preprocessing" intro="Preprocessing is optional. Filtering can remove useful siren harmonics or frequency-modulation detail, so always compare with the original. The original recording is never modified.">
      <div className="layout-split">
        <div className="stack">
          {act ? <>
            <section className="card"><h3>Original vs processed audio</h3><p className="muted">Active: {r.preprocessing.processing_steps.map((p: any) => p.step === "filter" ? `${p.detail.filter_type} ${p.detail.cutoff_hz.join("–")} Hz (${p.detail.method}, order ${p.detail.order})` : "adaptive noise reduction").join(" + ")}</p>
              <ABPlayer a={{ label: "Original", src: url(`/api/v1/roadsonic/${r.job_id}/audio?version=original`) }} b={{ label: "Processed", src: url(`/api/v1/roadsonic/${r.job_id}/audio?version=processed`) }} />
              {r.preprocessing.processing_steps.flatMap((p: any) => p.warnings ?? []).map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}</section>
            {r.waveform_processed && <WaveformChart original={r.waveform} filtered={r.waveform_processed} title="Waveform: original vs processed" />}
            {r.spectrogram_original && <div className="grid2"><SpectrogramChart sg={r.spectrogram_original} title="Spectrogram - original" fmax={Math.min(fs / 2, 4000)} height={300} /><SpectrogramChart sg={r.spectrogram} title="Spectrogram - processed" fmax={Math.min(fs / 2, 4000)} height={300} /></div>}
          </> : <section className="card empty"><h3>No preprocessing applied</h3><p className="muted">Choose a filter or enable noise reduction on the right, then apply. Skipping this step is fine.</p></section>}
        </div>
        {defaults && settings && <div className="card stack"><SettingsPanel embedded sections={["preprocessing"]} defaults={defaults} s={settings} setS={setSettings} dirty={dirty} busy={busy} hasAudio onRun={() => run(settings, false)} onReset={resetSettings} runLabel="Apply and re-analyze" />
          {busy && <ProcessingStatus label="Re-analyzing…" />}{error && <ErrorPanel message={error} />}</div>}
      </div>
    </WorkflowShell>
  );
}

const FEATS: [string, string][] = [["rms_db", "RMS level (dBFS)"], ["centroid_hz", "Spectral centroid (Hz)"], ["bandwidth_hz", "Spectral bandwidth (Hz)"], ["flatness", "Spectral flatness"], ["peak_prominence_db", "Peak prominence (dB)"], ["tonal_ratio", "Tonal ratio"], ["zcr", "Zero-crossing rate"]];
export function FeaturesStep() {
  const { rs } = useSession(), { defaults } = useRoadSonic(), r = rs.res, T = r.tracks, c = chartColors();
  const [sel, setSel] = useState<string[]>(["rms_db", "flatness"]);
  useMarkLoaded("roadsonic", "features", !!r);
  return (
    <WorkflowShell module="roadsonic" step="features" title="Feature analysis" intro={`Frame-level measurements computed from the ${r.detect_on} audio (frame ${r.config.features.frame_ms} ms, hop ${r.config.features.hop_ms} ms, band ${r.config.features.band_hz[0]}–${r.config.features.band_hz[1]} Hz). No events are drawn here.`}>
      <Plot title="Dominant-frequency track and tonal ratio" note="A siren makes the dominant frequency sweep or alternate while the tonal ratio stays high. A steady horn stays flat; broadband noise has a low tonal ratio."
        data={[{ x: T.time_s, y: T.dom_freq_hz, type: "scatter", mode: "markers", marker: { size: 3, color: c.c1 }, name: "dominant frequency (Hz)" }, { x: T.time_s, y: T.tonal_ratio, type: "scatter", mode: "lines", name: "tonal ratio", yaxis: "y2", line: { color: c.c2 } }]}
        layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Hz" }, yaxis2: { overlaying: "y", side: "right", range: [0, 1], title: "tonal ratio" } }} />
      <section className="card"><h3>Feature tracks</h3><fieldset className="rs-feats"><legend>Features to plot</legend>{FEATS.map(([k, l]) => <label key={k} className="inline"><input type="checkbox" checked={sel.includes(k)} onChange={(e) => setSel(e.target.checked ? [...sel, k] : sel.filter((x) => x !== k))} /> {l}</label>)}</fieldset></section>
      {sel.length > 0 && <Plot title="Selected feature tracks" height={Math.max(260, 150 * sel.length)}
        data={sel.map((k, i) => ({ x: T.time_s, y: T[k], type: "scatter", mode: "lines", name: FEATS.find((d) => d[0] === k)![1], yaxis: i === 0 ? "y" : `y${i + 1}` }))}
        layout={{ grid: { rows: sel.length, columns: 1, pattern: "coupled" }, xaxis: { title: "Time (s)" }, ...Object.fromEntries(sel.map((k, i) => [i === 0 ? "yaxis" : `yaxis${i + 1}`, { title: FEATS.find((d) => d[0] === k)![1].split(" (")[0] }])) }} />}
      <section className="card"><h3>What each feature means - and its limits</h3><dl>{Object.entries(defaults?.features_help ?? {}).map(([k, v]: any) => <div key={k}><dt className="mono">{k}</dt><dd className="muted">{v}</dd></div>)}</dl>
        <p className="muted">Frequency modulation and temporal consistency are evaluated by the detector rules in the next step (range and variation of the dominant frequency, fraction of tonal frames), not as separate plots here.</p></section>
    </WorkflowShell>
  );
}
