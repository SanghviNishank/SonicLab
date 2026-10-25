import WorkflowShell from "../../components/workflow/WorkflowShell";
import AudioPlayer from "../../components/audio/AudioPlayer";
import { WaveformChart } from "../../components/charts";
import { Metric } from "../../components/ui";
import { useMarkLoaded, useSession } from "../../context/Session";
import { url } from "../../api";

export default function OverviewStep() {
  const { cv } = useSession(), up = cv.upload, m = up.metadata, s = up.statistics, c = s.per_channel;
  useMarkLoaded("clearvoice", "overview", !!up);
  const f = (v: number, d = 4) => v.toFixed(d);
  return (
    <WorkflowShell module="clearvoice" step="overview" title="Audio overview" intro="Everything below was measured by the backend from the decoded samples of your file.">
      <section className="card"><div className="tiles">
        <Metric value={`${m.duration_s.toFixed(3)} s`} label="Duration" /><Metric value={`${(m.sample_rate_hz / 1000).toFixed(3)} kHz`} label="Sample rate" /><Metric value={m.samples_per_channel.toLocaleString()} label="Samples / channel" />
        <Metric value={m.channels} label="Channels" /><Metric value={f(Math.max(...c.map((x: any) => x.peak_abs)))} label="Peak amplitude" /><Metric value={f(Math.max(...c.map((x: any) => x.rms)))} label="RMS (loudest ch.)" /></div></section>
      <section className="card"><h3>Playback</h3><AudioPlayer src={url(`/api/v1/audio/${m.audio_id}/file`)} label="Original recording" /></section>
      <WaveformChart original={up.waveform} title="Waveform" />
      <section className="card"><h3>Per-channel statistics</h3><div className="table-wrap"><table><thead><tr><th>Ch</th><th>min</th><th>max</th><th>mean</th><th>RMS</th><th>variance*</th><th>peak</th></tr></thead>
        <tbody>{c.map((x: any, i: number) => <tr key={i}><td>{i}</td><td>{f(x.min)}</td><td>{f(x.max)}</td><td>{f(x.mean, 6)}</td><td>{f(x.rms)}</td><td>{f(x.variance, 6)}</td><td>{f(x.peak_abs)}</td></tr>)}</tbody></table></div>
        <p className="muted">*Population variance (divide by N). Amplitudes are relative to full scale = 1.0.</p>
        {s.warnings.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}</section>
      <section className="card"><h3>From sound to samples</h3><p className="eq">x[n] = x(n·Ts), &nbsp; Ts = 1/fs = {(1 / m.sample_rate_hz).toExponential(4)} s &nbsp; → &nbsp; t[n] = n/fs</p>
        <p className="muted">The recording is a list of {m.samples_per_channel.toLocaleString()} numbers per channel, one every {(1e6 / m.sample_rate_hz).toFixed(2)} µs. Everything else in SonicSense is computed from those numbers.</p></section>
    </WorkflowShell>
  );
}
