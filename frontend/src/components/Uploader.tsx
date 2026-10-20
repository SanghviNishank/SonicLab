import { useRef, useState } from "react";
import { upload } from "../api";

export default function Uploader({ onDone, onClear }: { onDone: (res: any, file: File) => void; onClear: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function handle(f: File) {
    setFile(f); setErr(""); setBusy(true);
    try {
      const res = await upload(f);
      onDone(res, f);
    } catch (e: any) {
      console.error("Audio upload error:", e);
      setErr(e.message || "Failed to process audio file");
      setFile(null);
      onClear();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h3>1 · Upload audio (WAV, FLAC, MP3, AAC, M4A, OGG, AIFF)</h3>
      <div className={"drop" + (drag ? " over" : "")} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}>
        {busy ? "Validating on server…" : "Drop an audio file here or click to choose"}
      </div>
      <input ref={input} type="file" accept=".wav,.flac,.mp3,.ogg,.m4a,.aac,.aif,.aiff,audio/*" hidden aria-label="Choose WAV file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ""; }} />
      {file && !err && <p className="muted">{file.name} · {(file.size / 1024).toFixed(0)} KB{" "}
        <button className="btn ghost" onClick={() => { setFile(null); onClear(); }}>Remove</button></p>}
      {err && <p className="error" role="alert">⚠ {err}</p>}
    </section>
  );
}
