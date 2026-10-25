import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatTime } from "../../logic/format.ts";

/** Two recordings played in lock-step; A/B switching only changes which one is audible (both stay at the same position).
 *  Levels are NOT matched: a louder version will sound "better". */
export default function ABPlayer({ a, b }: { a: { label: string; src: string }; b: { label: string; src: string } }) {
  const ra = useRef<HTMLAudioElement>(null), rb = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState<"a" | "b">("a"), [playing, setPlaying] = useState(false), [cur, setCur] = useState(0), [dur, setDur] = useState(0), [err, setErr] = useState("");
  useEffect(() => { if (ra.current) ra.current.muted = active !== "a"; if (rb.current) rb.current.muted = active !== "b"; }, [active]);
  useEffect(() => { setPlaying(false); setCur(0); setErr(""); }, [a.src, b.src]);
  const toggle = async () => {
    const x = ra.current, y = rb.current; if (!x || !y) return;
    if (x.paused) { y.currentTime = x.currentTime; try { await Promise.all([x.play(), y.play()]); setPlaying(true); } catch { setErr("Playback was blocked or the format is unsupported."); } }
    else { x.pause(); y.pause(); setPlaying(false); }
  };
  const seek = (t: number) => { if (ra.current) ra.current.currentTime = t; if (rb.current) rb.current.currentTime = t; setCur(t); };
  return (
    <div className="stack" role="group" aria-label="A/B comparison player">
      <audio ref={ra} src={a.src} preload="auto" onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration)} onEnded={() => { rb.current?.pause(); setPlaying(false); }} onError={() => setErr(`${a.label} could not be loaded.`)}
        onTimeUpdate={(e) => { const t = (e.target as HTMLAudioElement).currentTime; setCur(t); const y = rb.current; if (y && Math.abs(y.currentTime - t) > 0.15) y.currentTime = t; }} />
      <audio ref={rb} src={b.src} preload="auto" onError={() => setErr(`${b.label} could not be loaded.`)} />
      <div className="row">
        <button className="btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <div className="ab" role="group" aria-label="Which version you hear">
          <button aria-pressed={active === "a"} onClick={() => setActive("a")}>A · {a.label}</button><button aria-pressed={active === "b"} onClick={() => setActive("b")}>B · {b.label}</button></div>
        <span className="chip" role="status">Hearing: {active === "a" ? a.label : b.label}</span>
      </div>
      <div className="player" style={{ gridTemplateColumns: "1fr auto" }}>
        <input type="range" aria-label="Seek" min={0} max={dur || 0} step={0.01} value={Math.min(cur, dur || 0)} onChange={(e) => seek(Number(e.target.value))} />
        <span className="mono muted">{formatTime(cur)} / {formatTime(dur)}</span></div>
      <p className="muted">Levels are not matched between A and B. Compare tone and noise, not loudness.</p>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
