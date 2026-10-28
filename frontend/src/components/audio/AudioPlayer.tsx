import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { formatTime } from "../../logic/format.ts";
import { SPEEDS, actionForKey, clamp } from "../../logic/playerKeys.ts";

/** Accessible audio player: play/pause, seek, volume, mute, speed, keyboard control (Space/K, ←/→ ±5 s, Shift+←/→ ±1 s, M, ↑/↓) and
 *  readiness handling (controls stay disabled until the browser has decoded the metadata). Shortcuts work while focus is inside the player. */
export default function AudioPlayer({ src, label, onTime }: { src: string; label: string; onTime?: (t: number) => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false), [cur, setCur] = useState(0), [dur, setDur] = useState(0), [vol, setVol] = useState(1), [muted, setMuted] = useState(false), [rate, setRate] = useState(1);
  const [ready, setReady] = useState(false), [err, setErr] = useState("");
  useEffect(() => { setPlaying(false); setCur(0); setDur(0); setReady(false); setErr(""); }, [src]);
  useEffect(() => { if (ref.current) { ref.current.volume = vol; ref.current.muted = muted; ref.current.playbackRate = rate; } }, [vol, muted, rate, ready]);
  const toggle = () => { const a = ref.current; if (!a || !ready) return; if (a.paused) a.play().catch(() => setErr("Playback was blocked or the format is unsupported by this browser.")); else a.pause(); };
  const seek = (t: number) => { const a = ref.current; if (!a) return; const v = clamp(t, 0, dur || 0); a.currentTime = v; setCur(v); onTime?.(v); };
  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "SELECT") return;
    const act = actionForKey(e.key, e.shiftKey); if (!act) return;
    if ((e.target as HTMLElement).tagName === "INPUT" && (e.key.startsWith("Arrow") || e.key === " ") && (e.target as HTMLInputElement).type === "range") { if (act.type !== "toggle") return; }   // let sliders keep their native arrow behaviour
    e.preventDefault();
    if (act.type === "toggle") toggle(); else if (act.type === "seek") seek(cur + act.delta); else if (act.type === "mute") setMuted((m) => !m); else setVol((v) => clamp(v + act.delta, 0, 1));
  }
  return (
    <div className="player" role="group" aria-label={label} onKeyDown={onKey} aria-describedby={undefined}>
      <audio ref={ref} src={src} preload="metadata" onLoadedMetadata={(e) => { setDur((e.target as HTMLAudioElement).duration); setReady(true); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => { const t = (e.target as HTMLAudioElement).currentTime; setCur(t); onTime?.(t); }} onError={() => { setReady(false); setErr("This audio could not be loaded or decoded by your browser."); }} />
      <button className="btn" onClick={toggle} disabled={!ready} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <input type="range" aria-label={`Seek ${label}`} disabled={!ready} min={0} max={dur || 0} step={0.01} value={Math.min(cur, dur || 0)} onChange={(e) => seek(Number(e.target.value))} />
      <span className="mono muted" aria-live="off">{ready ? `${formatTime(cur)} / ${formatTime(dur)}` : err ? "unavailable" : "loading…"}</span>
      <div className="player-extra" style={{ gridColumn: "1 / -1" }}>
        <button className="btn ghost" onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : vol} onChange={(e) => { setMuted(false); setVol(Number(e.target.value)); }} />
        <label className="inline"><span className="muted">Speed</span> <select aria-label="Playback speed" value={rate} onChange={(e) => setRate(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select></label>
        <span className="muted kbd-hint">Space play/pause · ←/→ seek 5 s · M mute</span>
      </div>
      {err && <p className="error" role="alert" style={{ gridColumn: "1 / -1" }}>{err}</p>}
    </div>
  );
}
