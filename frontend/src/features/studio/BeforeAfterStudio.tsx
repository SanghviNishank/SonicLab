import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, Volume2, VolumeX, Repeat } from "lucide-react";
import { call, isAborted, url } from "../../api";
import { WaveformChart } from "../../components/charts";
import Plot from "../../components/Plot";
import { formatTime } from "../../logic/format.ts";
import { comparableDuration, fmtDb, levelRows, needsResync, normalizeSection, processedUrl, sectionAction, type Section } from "../../logic/studio.ts";
import { chartColors } from "../../components/charts/colors";

interface Props { audioId: string; jobId: string; fs: number; waveOriginal: any; waveProcessed: any; settingsLabel: string; config: any }

/** Before vs After Studio. Both players play the ACTUAL files: the uploaded original and the backend-generated processed WAV.
 *  Neither is normalised by the page; loudness matching is an optional mode in which the BACKEND scales a copy of the processed audio. */
export default function BeforeAfterStudio({ audioId, jobId, fs, waveOriginal, waveProcessed, settingsLabel, config }: Props) {
  const ro = useRef<HTMLAudioElement>(null), rp = useRef<HTMLAudioElement>(null);
  const [lv, setLv] = useState<any>(null), [lvErr, setLvErr] = useState("");
  const [matched, setMatched] = useState(false), [active, setActive] = useState<"a" | "b">("a"), [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0), [dO, setDO] = useState(0), [dP, setDP] = useState(0), [vol, setVol] = useState(1), [muted, setMuted] = useState(false);
  const [readyO, setReadyO] = useState(false), [readyP, setReadyP] = useState(false), [err, setErr] = useState("");
  const [secIn, setSecIn] = useState({ start: "", end: "" }), [section, setSection] = useState<Section | null>(null), [secErr, setSecErr] = useState(""), [loop, setLoop] = useState(true);
  const [auto, setAuto] = useState(false);
  const pending = useRef<{ t: number; play: boolean } | null>(null), lastTime = useRef(0);
  const srcO = url(`/api/v1/audio/${audioId}/file`), srcP = processedUrl(url(""), jobId, matched);
  const dur = comparableDuration(dO, dP);

  useEffect(() => {
    const ctl = new AbortController(); setLv(null); setLvErr("");
    call(`/api/v1/clearvoice/${jobId}/levels`, { signal: ctl.signal }).then(setLv).catch((e) => { if (!isAborted(e)) setLvErr(e.message); });
    return () => ctl.abort();
  }, [jobId]);
  useEffect(() => { setPlaying(false); setCur(0); setReadyO(false); setReadyP(false); setErr(""); setMatched(false); setSection(null); }, [audioId, jobId]);
  useEffect(() => { for (const [r, on] of [[ro, "a"], [rp, "b"]] as const) if (r.current) { r.current.volume = vol; r.current.muted = muted || active !== on; } }, [vol, muted, active, readyO, readyP]);
  useEffect(() => { if (!auto || !playing) return; const id = setInterval(() => setActive((a) => (a === "a" ? "b" : "a")), 3000); return () => clearInterval(id); }, [auto, playing]);

  const both = useCallback((f: (a: HTMLAudioElement) => void) => { if (ro.current) f(ro.current); if (rp.current) f(rp.current); }, []);
  const seek = useCallback((t: number) => { const v = Math.max(0, Math.min(t, dur || t)); both((a) => { a.currentTime = v; }); setCur(v); lastTime.current = v; }, [both, dur]);
  const pause = useCallback(() => { both((a) => a.pause()); setPlaying(false); }, [both]);
  const play = useCallback(async () => {
    const a = ro.current, b = rp.current; if (!a || !b || !readyO || !readyP) return;
    let from = a.currentTime; if (section && (from < section.start || from >= section.end)) from = section.start; if (dur && from >= dur - 0.05) from = 0;
    a.currentTime = from; b.currentTime = from; setErr("");
    const r = await Promise.allSettled([a.play(), b.play()]);
    if (r.some((x) => x.status === "rejected")) { both((x) => x.pause()); setPlaying(false); setErr("Playback was blocked by the browser or one file could not be played. Press Compare Audio again."); return; }
    setPlaying(true);
  }, [both, dur, readyO, readyP, section]);
  const toggle = () => (playing ? pause() : void play());

  function onTime() {
    const a = ro.current, b = rp.current; if (!a || !b) return;
    let t = a.currentTime; setCur(t); lastTime.current = t;
    if (!a.paused && needsResync(b.currentTime, t)) b.currentTime = t;                        // keep the two files at the same position
    const act = sectionAction(t, section, loop);
    if (act === "loop" && section) { seek(section.start); }
    else if (act === "stop" || (dur > 0 && t >= dur - 0.02)) { pause(); }
  }
  function onMetaP() {                                                                         // after switching to/from the loudness-matched copy, resume where we were
    if (rp.current) setDP(rp.current.duration); setReadyP(true);
    const p = pending.current; if (p && rp.current) { rp.current.currentTime = p.t; pending.current = null; if (p.play) void play(); }
  }
  function toggleMatch(v: boolean) { pending.current = { t: ro.current?.currentTime ?? 0, play: playing }; setReadyP(false); setPlaying(false); both((a) => a.pause()); setMatched(v); }
  function applySection() {
    const r = normalizeSection(Number(secIn.start), Number(secIn.end), dur); setSecErr(r.error); setSection(r.section);
    if (r.section) seek(r.section.start);
  }
  const rows = useMemo(() => (lv ? levelRows(lv) : []), [lv]);
  const sectionShape = section ? [{ type: "rect", xref: "x", yref: "paper", x0: section.start, x1: section.end, y0: 0, y1: 1, fillcolor: "rgba(255,176,32,0.18)", line: { width: 0 } }] : [];
  const cursor = { type: "line", xref: "x", yref: "paper", x0: cur, x1: cur, y0: 0, y1: 1, line: { color: "#ff5d73", width: 1 } };
  const c = chartColors();
  const diff = lv?.waveform_difference;
  const failed = !!err && !readyO && !readyP;

  return (
    <section className="card stack studio" aria-labelledby="studio-h" onKeyDown={(e) => { const t = e.target as HTMLElement; if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.key === " ") { e.preventDefault(); toggle(); } else if (e.key === "a" || e.key === "A") setActive("a"); else if (e.key === "b" || e.key === "B") setActive("b");
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(cur - 5); } else if (e.key === "ArrowRight") { e.preventDefault(); seek(cur + 5); } }}>
      <h2 id="studio-h">Before vs After Studio</h2>
      <p className="callout">Listen to the original recording first. Now listen to the processed recording. Notice whether the unwanted background sound has decreased while the voice remains clear.</p>
      <audio ref={ro} src={srcO} preload="auto" data-testid="audio-original" onLoadedMetadata={(e) => { setDO((e.target as HTMLAudioElement).duration); setReadyO(true); }} onTimeUpdate={onTime}
        onError={() => { setReadyO(false); setErr("The original recording could not be loaded for playback."); }} />
      <audio ref={rp} src={srcP} preload="auto" data-testid="audio-processed" onLoadedMetadata={onMetaP} onError={() => { setReadyP(false); setErr("The processed recording could not be loaded for playback."); }} />

      <div className="studio-players">
        {([["a", "Original", dO, readyO, "Your uploaded file, unchanged."], ["b", "Processed", dP, readyP, matched ? "Backend-generated, scaled to the original's RMS (loudness-matched)." : "Backend-generated result, no normalisation."]] as const).map(([k, name, d, ready, note]) => (
          <div key={k} className={"player-card" + (active === k ? " on" : "")}>
            <div className="row"><b>{name}</b>{active === k && <span className="chip ok" role="status">● Hearing this</span>}</div>
            <p className="muted">{note}</p>
            <p className="mono">{ready ? `${formatTime(d)} long` : err && !ready ? "unavailable" : "loading…"}</p>
            <div className="bar" aria-hidden="true"><i style={{ width: `${d ? Math.min(100, (100 * cur) / d) : 0}%` }} /></div>
          </div>))}
      </div>
      {dO > 0 && dP > 0 && Math.abs(dO - dP) > 1e-3 && <p className="warn">⚠ The two files differ in length by {Math.abs(dO - dP).toFixed(3)} s; playback stops at the shorter one ({formatTime(dur)}).</p>}

      <div className="row studio-controls">
        <button className="btn" onClick={toggle} disabled={!readyO || !readyP} aria-label={playing ? "Pause both recordings" : "Compare Audio: play both recordings in sync"}>{playing ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Compare Audio</>}</button>
        <div className="ab" role="group" aria-label="Which version you hear"><button aria-pressed={active === "a"} onClick={() => setActive("a")}>A · Original</button><button aria-pressed={active === "b"} onClick={() => setActive("b")}>B · Processed</button></div>
        <button className="btn ghost" onClick={() => setActive((a) => (a === "a" ? "b" : "a"))} aria-label="Switch between original and processed">Switch A/B</button>
        <label className="inline"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-alternate every 3 s</label>
      </div>
      <div className="player" style={{ gridTemplateColumns: "1fr auto" }}>
        <input type="range" aria-label="Playback position" min={0} max={dur || 0} step={0.01} value={Math.min(cur, dur || 0)} disabled={!readyO || !readyP} onChange={(e) => seek(Number(e.target.value))} />
        <span className="mono muted">{formatTime(cur)} / {formatTime(dur)}</span>
      </div>
      <div className="player-extra">
        <button className="btn ghost" onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : vol} onChange={(e) => { setMuted(false); setVol(Number(e.target.value)); }} />
        <label className="inline"><input type="checkbox" checked={matched} onChange={(e) => toggleMatch(e.target.checked)} disabled={!lv || lv.loudness_match_gain_db == null} /> Loudness-matched (optional){lv?.loudness_match_gain_db != null && <span className="muted"> · gain {fmtDb(lv.loudness_match_gain_db, 2)}</span>}</label>
        <span className="muted kbd-hint">Space play/pause · A / B switch · ←/→ seek 5 s</span>
      </div>
      {failed && <p className="error" role="alert">{err}</p>}{!failed && err && <p className="error" role="alert">{err}</p>}

      <fieldset className="section-pick"><legend>Listen to a short section</legend>
        <div className="row">
          <label>Start (s)<input type="number" min={0} step={0.1} value={secIn.start} onChange={(e) => setSecIn({ ...secIn, start: e.target.value })} /></label>
          <label>End (s)<input type="number" min={0} step={0.1} value={secIn.end} onChange={(e) => setSecIn({ ...secIn, end: e.target.value })} /></label>
          <button className="btn ghost" onClick={() => setSecIn({ ...secIn, start: cur.toFixed(2) })}>Start = now</button>
          <button className="btn ghost" onClick={() => setSecIn({ ...secIn, end: cur.toFixed(2) })}>End = now</button>
          <button className="btn" onClick={applySection} disabled={!dur}>Use section</button>
          {section && <button className="btn ghost" onClick={() => { setSection(null); setSecErr(""); }}>Clear</button>}
          <label className="inline"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> <Repeat size={14} aria-hidden="true" /> Loop</label>
        </div>
        {secErr && <p className="error" role="alert">{secErr}</p>}
        {section && <p className="chip ok" role="status">Section {section.start.toFixed(2)}–{section.end.toFixed(2)} s {loop ? "(looping)" : ""}</p>}
      </fieldset>

      <WaveformChart original={waveOriginal} filtered={waveProcessed} title="Waveform: original vs processed" note="Click the waveform to move the playback position. The amber band is your selected section; the red line is the current position."
        onClick={(x) => seek(x)} layout={{ shapes: [...sectionShape, cursor] }} />
      {diff ? <Plot title="Waveform difference (original − processed)" height={220} note={lv.difference_note}
        data={diff.channels.map((ch: any, i: number) => ({ x: ch.t, y: ch.y, type: "scatter", mode: "lines", name: `ch${i}`, line: { width: 1, color: i ? c.c2 : c.event } }))}
        layout={{ xaxis: { title: "Time (s)" }, yaxis: { title: "Amplitude" } }} />
        : lvErr ? <p className="error" role="alert">Difference waveform unavailable: {lvErr}</p> : null}

      <div className="stack"><h3>Measured levels</h3>
        {lv ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Measure</th><th>Original</th><th>Processed</th><th>Change</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="mono">{r.original}</td><td className="mono">{r.processed}</td><td className="mono">{r.change}</td></tr>)}
            <tr><td>Duration</td><td className="mono">{lv.original.duration_s.toFixed(3)} s</td><td className="mono">{lv.processed.duration_s.toFixed(3)} s</td><td className="mono">{lv.duration_difference_s.toFixed(3)} s</td></tr></tbody></table></div>
          : lvErr ? <p className="error" role="alert">Levels unavailable: {lvErr}</p> : <p className="muted" role="status">Measuring levels…</p>}
        {lv?.notes.map((n: string, i: number) => <p key={i} className="muted">{n}</p>)}
        <p><b>Processing applied:</b> {settingsLabel}. <span className="muted">{config?.method === "zero_phase" ? "Zero-phase: no time delay." : config?.method === "causal" ? "Causal: the processed audio is slightly delayed." : ""}</span></p>
        <p className="muted">These measurements describe how the signal changed. Whether it sounds better is for your ears to judge; no improvement is claimed.</p>
      </div>
      <div className="actions">
        <a className="btn" href={url(`/api/v1/clearvoice/${jobId}/download`)}><Download size={16} /> Download processed WAV</a>
        {lv?.loudness_match_gain_db != null && <a className="btn ghost" href={url(`/api/v1/clearvoice/${jobId}/download?match_loudness=true`)}>Download loudness-matched copy</a>}
        <a className="btn ghost" href={srcO}>Original (unchanged)</a>
      </div>
    </section>
  );
}
