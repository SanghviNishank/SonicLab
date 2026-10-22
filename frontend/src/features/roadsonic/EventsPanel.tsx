import { url } from "../../api";

/** SVG timeline of the whole recording. Events are drawn from the backend result only. Not colour-only: each has a number and an outline. */
export function EventTimeline({ events, duration, sel, cursor, onSelect }: { events: any[]; duration: number; sel: number | null; cursor: number | null; onSelect: (i: number) => void }) {
  const W = 1000, H = 64;
  const x = (t: number) => (duration > 0 ? (t / duration) * W : 0);
  const ticks = Array.from({ length: 11 }, (_, i) => (duration * i) / 10);
  return (
    <figure className="rs-timeline" aria-label="Candidate event timeline">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="group" aria-label={`Timeline of ${duration.toFixed(1)} seconds with ${events.length} candidate events`} preserveAspectRatio="none">
        <rect x={0} y={0} width={W} height={H} className="rs-tl-bg" />
        {ticks.map((t, i) => <g key={i}><line x1={x(t)} x2={x(t)} y1={0} y2={H} className="rs-tl-grid" /><text x={x(t)} y={H + 13} className="rs-tl-tick" textAnchor={i === 0 ? "start" : i === 10 ? "end" : "middle"}>{t.toFixed(duration < 20 ? 1 : 0)}s</text></g>)}
        {events.map((e, i) => (
          <g key={i} role="button" tabIndex={0} aria-label={`Event ${i + 1}: ${e.start_s.toFixed(2)} to ${e.end_s.toFixed(2)} seconds`} aria-pressed={sel === i}
            onClick={() => onSelect(i)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(i); } }} className={"rs-tl-event" + (sel === i ? " sel" : "")}>
            <rect x={x(e.start_s)} y={6} width={Math.max(2, x(e.end_s) - x(e.start_s))} height={H - 12} rx={3} />
            <text x={x(e.start_s) + 6} y={H / 2 + 5}>#{i + 1}</text>
          </g>))}
        {cursor != null && <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} className="rs-tl-cursor" />}
      </svg>
      {events.length === 0 && <figcaption className="muted">No candidate events under the current settings. This does not prove that no siren is present.</figcaption>}
    </figure>
  );
}

export default function EventsPanel({ res, sel, onSelect, onPlay, pre, post, setPre, setPost, clipSrc, clipKey, clipStart, onClipTime, jobId }:
  { res: any; sel: number | null; onSelect: (i: number) => void; onPlay: (i: number) => void; pre: number; post: number; setPre: (n: number) => void; setPost: (n: number) => void;
    clipSrc: string | null; clipKey: string; clipStart: number; onClipTime: (t: number) => void; jobId: string }) {
  const events: any[] = res.events;
  const e = sel != null ? events[sel] : null;
  return (
    <div className="rs-events">
      <div className="rs-event-list" role="list" aria-label="Candidate events">
        {events.length === 0 && <div className="empty"><p><b>No candidate events.</b></p><p className="muted">Nothing met every rule. Try a lower-sensitivity threshold only if you expect a quieter or narrower-sweep siren, and expect more false alarms.</p></div>}
        {events.map((ev, i) => (
          <button key={i} role="listitem" className={"rs-event-row" + (sel === i ? " sel" : "")} aria-pressed={sel === i} onClick={() => onSelect(i)}>
            <b>#{i + 1}</b><span>{ev.start_s.toFixed(2)}–{ev.end_s.toFixed(2)} s</span><span>{ev.duration_s.toFixed(2)} s</span>
            <span title={ev.score_definition}>score {ev.heuristic_score.toFixed(2)}</span><span className="rs-tag">candidate siren event</span>
          </button>))}
      </div>
      <section className="card rs-evidence" aria-live="polite">
        <h3>Evidence</h3>
        {!e && <p className="muted">Select an event on the timeline or in the list to see why it was flagged, play it, and zoom the plots to it.</p>}
        {e && <>
          <p><b>Event #{sel! + 1}</b> · {e.start_s.toFixed(3)}–{e.end_s.toFixed(3)} s · {e.duration_s.toFixed(3)} s · method: {e.method}</p>
          <p>{e.explanation}</p>
          <div className="table-wrap"><table><thead><tr><th>Rule</th><th>Result</th></tr></thead><tbody>
            {Object.entries(e.rules).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{v ? "✔ passed" : "✖ not met"}</td></tr>)}</tbody></table></div>
          <div className="table-wrap"><table><thead><tr><th>Feature (event mean)</th><th>Value</th></tr></thead><tbody>
            <tr><td>Dominant frequency range</td><td>{e.features.f0_min_hz?.toFixed(0)}–{e.features.f0_max_hz?.toFixed(0)} Hz</td></tr>
            <tr><td>Tonal fraction / strength</td><td>{e.features.tonal_fraction.toFixed(2)} / {e.features.mean_tonal_ratio.toFixed(2)}</td></tr>
            <tr><td>Level</td><td>{e.features.mean_rms_db.toFixed(1)} dBFS</td></tr>
            <tr><td>Centroid / bandwidth</td><td>{e.features.mean_centroid_hz.toFixed(0)} / {e.features.mean_bandwidth_hz.toFixed(0)} Hz</td></tr>
            <tr><td>Flatness / peak prominence</td><td>{e.features.mean_flatness.toFixed(3)} / {e.features.mean_peak_prominence_db.toFixed(1)} dB</td></tr>
            <tr><td>Observed pattern</td><td>{e.trajectory.pattern}</td></tr></tbody></table></div>
          <p className="muted">Score = {e.score_definition}. Terms: {Object.entries(e.evidence_terms).map(([k, v]: any) => `${k} ${v.toFixed(2)}`).join(", ")}.</p>
          <div className="form">
            <label>Context before (s)<input type="number" min={0} max={30} step={0.5} value={pre} onChange={(ev) => setPre(Number(ev.target.value))} /></label>
            <label>Context after (s)<input type="number" min={0} max={30} step={0.5} value={post} onChange={(ev) => setPost(Number(ev.target.value))} /></label>
          </div>
          <p className="actions"><button className="btn" onClick={() => onPlay(sel!)}>▶ Play event with context</button>
            <a className="btn ghost" href={url(`/api/v1/roadsonic/${jobId}/event/${sel}/audio?pre=${pre}&post=${post}&version=original`)}>Download clip (WAV)</a></p>
          {clipSrc && <audio key={clipKey} controls autoPlay src={clipSrc} style={{ width: "100%" }} aria-label={`Event ${sel! + 1} with context`} onTimeUpdate={(ev) => onClipTime(clipStart + (ev.target as HTMLAudioElement).currentTime)} />}
        </>}
      </section>
    </div>
  );
}
