import { useState } from "react";
import { del, url } from "../../api";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import AudioUploader from "../../components/audio/AudioUploader";
import AudioPlayer from "../../components/audio/AudioPlayer";
import { SpectrogramChart, SpectrumChart, WaveformChart } from "../../components/charts";
import { ConfirmDialog, ErrorPanel, Metric, ProcessingStatus } from "../../components/ui";
import { useMarkLoaded, useSession } from "../../context/Session";
import { useRoadSonic } from "./useRoadSonic";

export function UploadStep() {
  const { rs, patchRs, discard } = useSession(), { defaults, run, busy, error, settings } = useRoadSonic();
  const [replacing, setReplacing] = useState(false), [confirm, setConfirm] = useState<"replace" | "remove" | null>(null), up = rs.upload;
  async function uploaded(res: any) {
    const old = rs.upload?.metadata.audio_id;
    patchRs({ upload: res, res: null, detected: false, sel: null, reviewed: {}, loaded: {}, lastRun: "" }); setReplacing(false);
    if (old) { try { await del(`/api/v1/audio/${old}`); } catch { /* already expired */ } }
  }
  return (
    <WorkflowShell module="roadsonic" step="upload" title="Upload traffic audio" nextLabel="Validate and Continue" nextDisabled={!up || !defaults || !settings} nextBusy={busy}
      onNext={async () => (rs.res ? true : await run(settings, false))}
      intro="Upload a traffic recording. The server validates the real file content. Continuing runs the signal analysis (spectra and features) with default settings; no events are shown until you run detection.">
      {(!up || replacing) && <section className="card"><AudioUploader onUploaded={uploaded} current={up ? { name: up.file?.name ?? "recording" } : null} /></section>}
      {up && !replacing && <section className="card stack"><h3>Validated recording</h3><p><b>{up.file?.name ?? "Restored recording"}</b></p>
        <div className="tiles"><Metric value={`${up.metadata.duration_s.toFixed(2)} s`} label="Duration" /><Metric value={`${up.metadata.sample_rate_hz} Hz`} label="Sample rate" /><Metric value={up.metadata.channels} label="Channels" /></div>
        <AudioPlayer src={url(`/api/v1/audio/${up.metadata.audio_id}/file`)} label="Traffic recording" />
        <div className="actions"><button className="btn ghost" onClick={() => (rs.res ? setConfirm("replace") : setReplacing(true))}>Replace file</button><button className="btn danger" onClick={() => setConfirm("remove")}>Remove file</button></div></section>}
      {busy && <ProcessingStatus label="Analyzing the recording on the server…" />}{error && <ErrorPanel message={error} onRetry={() => run(settings, false)} />}
      <ConfirmDialog open={confirm === "replace"} title="Replace the recording?" body="The current analysis and any detection results will be discarded." confirmLabel="Choose a new file" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); setReplacing(true); }} />
      <ConfirmDialog open={confirm === "remove"} danger title="Remove this recording?" body="The recording and its results are deleted from the server and this session." confirmLabel="Remove" onCancel={() => setConfirm(null)} onConfirm={async () => { setConfirm(null); await discard("roadsonic"); setReplacing(false); }} />
    </WorkflowShell>
  );
}

export function OverviewStep() {
  const { rs } = useSession(), r = rs.res, up = rs.upload, fs = r.summary.sample_rate_hz;
  useMarkLoaded("roadsonic", "overview", !!r);
  return (
    <WorkflowShell module="roadsonic" step="overview" title="Traffic audio overview" intro="Measurements of the recording itself. A strong spectral peak alone does not mean a siren: horns, engines and speech produce peaks too.">
      <section className="card"><div className="tiles"><Metric value={`${r.summary.duration_s.toFixed(2)} s`} label="Duration" /><Metric value={`${fs} Hz`} label="Sample rate" /><Metric value={r.summary.channels} label="Channels" />
        <Metric value={Math.max(...up.statistics.per_channel.map((c: any) => c.peak_abs)).toFixed(3)} label="Peak" /><Metric value={Math.max(...up.statistics.per_channel.map((c: any) => c.rms)).toFixed(4)} label="RMS" /></div>
        {up.statistics.warnings.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}</section>
      <section className="card"><h3>Playback</h3><AudioPlayer src={url(`/api/v1/audio/${up.metadata.audio_id}/file`)} label="Traffic recording" /></section>
      <WaveformChart original={r.waveform} title="Waveform" />
      <SpectrumChart xmax={Math.min(fs / 2, 6000)} spectra={[{ name: "spectrum", ...r.spectrum }]} note={`Hann window · bin spacing ${r.spectrum.bin_spacing_hz.toFixed(3)} Hz · analysed: ${r.spectrum.analysed}. Dominant peaks (estimates): ${r.spectrum.peaks.map((p: any) => p.frequency_hz.toFixed(0) + " Hz").join(", ") || "none"}`} />
      <SpectrogramChart sg={r.spectrogram} fmax={Math.min(fs / 2, 4000)} />
    </WorkflowShell>
  );
}
