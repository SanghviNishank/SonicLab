import { useState } from "react";
import { Link } from "react-router-dom";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import { SpectrogramChart, WaveformChart } from "../../components/charts";
import { EmptyState, ErrorPanel, ProcessingStatus } from "../../components/ui";
import SettingsPanel from "../../features/roadsonic/SettingsPanel";
import EventsPanel, { EventTimeline } from "../../features/roadsonic/EventsPanel";
import { eventOverlays } from "../../features/roadsonic/overlays";
import { useMarkLoaded, useSession } from "../../context/Session";
import { url } from "../../api";
import { useRoadSonic } from "./useRoadSonic";

export function DetectStep() {
  const { rs } = useSession(), { defaults, settings, setSettings, resetSettings, run, busy, error, dirty } = useRoadSonic(), r = rs.res, done = rs.detected;
  return (
    <WorkflowShell module="roadsonic" step="detect" title="Candidate siren detection" nextLabel="View event timeline" nextDisabled={!done || dirty}
      intro="Rule-based detector (not machine learning): a frame is tonal when one spectral peak dominates; a window passes when tonality persists and the dominant frequency sweeps or alternates. Passing windows are merged into candidate events.">
      <div className="layout-split">
        <div className="stack">
          <section className="card stack"><h3>Status</h3>
            {busy ? <ProcessingStatus label="Running detection on the full-resolution audio…" /> : done ? <p className={dirty ? "warn" : "ok"} role="status">{dirty ? "● Settings changed since the last run: rerun detection." : `✓ Detection finished in ${r.processing_s.toFixed(2)} s: ${r.events.length} candidate event(s) found in the ${r.detect_on} audio.`}</p> : <p className="muted">Not run yet. Review the settings, then run detection.</p>}
            {error && <ErrorPanel message={error} onRetry={() => run(settings, true)} />}
            {done && !dirty && r.events.length === 0 && <EmptyState title="No candidate events" body="Nothing met every rule with these settings. That does not prove that no siren is present; a distant or masked siren can be missed." />}
            <div className="actions"><button className="btn" disabled={busy || !settings} onClick={() => run(settings, true)}>{busy ? "Detecting…" : done ? "Rerun detection" : "Run candidate detection"}</button>
              {done && !dirty && <Link className="btn ghost" to="/roadsonic/events">View event timeline</Link>}</div></section>
          {done && <section className="card"><h3>Parameters used in the last run</h3><div className="table-wrap"><table><tbody>
            {Object.entries({ ...r.config.detector, frame_ms: r.config.features.frame_ms, hop_ms: r.config.features.hop_ms, "band (Hz)": r.config.features.band_hz.join("–"), "audio analysed": r.detect_on }).map(([k, v]: any) => <tr key={k}><td>{k}</td><td className="mono">{String(v)}</td></tr>)}</tbody></table></div>
            <p className="muted">Evidence score = mean of tonal fraction, modulation and tonal strength (each 0–1). It ranks candidates; it is not a probability and is not calibrated.</p></section>}
        </div>
        {defaults && settings && <div className="card"><SettingsPanel embedded sections={["sensitivity", "analysis", "detector"]} defaults={defaults} s={settings} setS={setSettings} dirty={dirty} busy={busy} hasAudio onRun={() => run(settings, true)} onReset={resetSettings} runLabel={done ? "Rerun detection" : "Run candidate detection"} /></div>}
      </div>
    </WorkflowShell>
  );
}

export function EventsStep() {
  const { rs, patchRs } = useSession(), r = rs.res, sel = rs.sel, duration = r.summary.duration_s, fs = r.summary.sample_rate_hz;
  const [pre, setPre] = useState(2), [post, setPost] = useState(2), [clip, setClip] = useState<{ src: string; key: string; start: number } | null>(null), [cursor, setCursor] = useState<number | null>(null);
  useMarkLoaded("roadsonic", "events", !!r);
  const ov = eventOverlays(r.events, sel, cursor);
  const select = (i: number) => { patchRs({ sel: i }); setCursor(r.events[i].start_s); };
  const play = (i: number) => { select(i); setClip({ src: url(`/api/v1/roadsonic/${r.job_id}/event/${i}/audio?pre=${pre}&post=${post}&version=original`), key: `${r.job_id}-${i}-${pre}-${post}`, start: Math.max(0, r.events[i].start_s - pre) }); };
  const xr = sel != null ? [Math.max(0, r.events[sel].start_s - pre), Math.min(duration, r.events[sel].end_s + post)] : undefined;
  return (
    <WorkflowShell module="roadsonic" step="events" title="Candidate event timeline" nextLabel="Review events" intro="Every event below was returned by the detector for this recording and these settings. Select one to zoom the plots and inspect the evidence.">
      <section className="card"><h3>Timeline ({r.events.length} candidate event{r.events.length === 1 ? "" : "s"})</h3><EventTimeline events={r.events} duration={duration} sel={sel} cursor={cursor} onSelect={select} /></section>
      <EventsPanel res={r} sel={sel} onSelect={select} onPlay={play} pre={pre} post={post} setPre={setPre} setPost={setPost} clipSrc={clip?.src ?? null} clipKey={clip?.key ?? ""} clipStart={clip?.start ?? 0} onClipTime={setCursor} jobId={r.job_id} />
      <WaveformChart original={r.waveform} title="Waveform with candidate events" layout={{ ...ov, xaxis: { title: "Time (s)", range: xr, autorange: !xr }, uirevision: String(sel) }} />
      <SpectrogramChart sg={r.spectrogram} title="Spectrogram with candidate events" fmax={Math.min(fs / 2, 4000)} shapes={ov.shapes} />
    </WorkflowShell>
  );
}
