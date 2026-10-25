import { useRef, useState } from "react";
import { FileAudio, UploadCloud } from "lucide-react";
import { uploadWithProgress } from "../../api";
import { formatBytes } from "../../logic/format.ts";
import { ErrorPanel, ProcessingStatus } from "../ui";

export default function AudioUploader({ onUploaded, current, hint }: { onUploaded: (res: any, file: File) => void; current?: { name: string; size?: number } | null; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false), [pct, setPct] = useState<number | null>(null), [err, setErr] = useState(""), [file, setFile] = useState<File | null>(null);
  async function handle(f: File) {
    setFile(f); setErr(""); setPct(0);
    try { const res = await uploadWithProgress(f, setPct); setPct(null); onUploaded({ ...res, file: { name: f.name, size: f.size } }, f); }
    catch (e: any) { setPct(null); setErr(e.message); setFile(null); }
  }
  const busy = pct !== null;
  return (
    <div className="stack">
      <div className={"drop" + (drag ? " over" : "")} role="button" tabIndex={0} aria-label="Choose or drop an audio file"
        onClick={() => !busy && input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f && !busy) handle(f); }}>
        <UploadCloud size={36} aria-hidden="true" /><h3>{current ? "Replace the audio file" : "Drop an audio file here, or click to choose"}</h3>
        <p className="muted">{hint ?? "WAV, FLAC, MP3, OGG, M4A or AIFF · mono or stereo · up to 50 MB and 5 minutes. The server checks the real file content, not the extension."}</p>
      </div>
      <input ref={input} type="file" hidden accept=".wav,.flac,.mp3,.ogg,.m4a,.aac,.aif,.aiff,audio/*" aria-label="Choose audio file" onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ""; }} />
      {busy && <ProcessingStatus label={`Uploading ${file?.name ?? ""} and validating on the server…`} progress={pct} />}
      {current && !busy && <p className="row"><FileAudio size={16} aria-hidden="true" /> <b>{current.name}</b> {current.size != null && <span className="muted">· {formatBytes(current.size)}</span>}</p>}
      {err && <ErrorPanel message={err} hint="Check that the file is a real, complete audio recording within the size and length limits, then choose it again." />}
    </div>
  );
}
