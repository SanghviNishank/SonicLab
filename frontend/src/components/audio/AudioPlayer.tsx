import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2 } from "lucide-react";
import { formatTime } from "../../logic/format.ts";

export default function AudioPlayer({ src, label, onTime }: { src: string; label: string; onTime?: (t: number) => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false), [cur, setCur] = useState(0), [dur, setDur] = useState(0), [vol, setVol] = useState(1), [err, setErr] = useState("");
  useEffect(() => { setPlaying(false); setCur(0); setErr(""); }, [src]);
  useEffect(() => { if (ref.current) ref.current.volume = vol; }, [vol]);
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) a.play().catch(() => setErr("Playback was blocked or the format is unsupported by this browser.")); else a.pause(); };
  return (
    <div className="player" role="group" aria-label={label}>
      <audio ref={ref} src={src} preload="metadata" onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => { const t = (e.target as HTMLAudioElement).currentTime; setCur(t); onTime?.(t); }} onError={() => setErr("This audio could not be loaded or decoded by your browser.")} />
      <button className="btn" onClick={toggle} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <input type="range" aria-label={`Seek ${label}`} min={0} max={dur || 0} step={0.01} value={Math.min(cur, dur || 0)} onChange={(e) => { const t = Number(e.target.value); if (ref.current) ref.current.currentTime = t; setCur(t); }} />
      <span className="mono muted" aria-live="off">{formatTime(cur)} / {formatTime(dur)}</span>
      <label className="vol inline"><Volume2 size={16} aria-hidden="true" /><span className="sr">Volume</span><input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} /></label>
      {err && <p className="error" role="alert" style={{ gridColumn: "1 / -1" }}>{err}</p>}
    </div>
  );
}
