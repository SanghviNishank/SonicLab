import { useState } from "react";
import { del } from "../../api";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import AudioUploader from "../../components/audio/AudioUploader";
import { ConfirmDialog } from "../../components/ui";
import { useSession } from "../../context/Session";

export default function UploadStep() {
  const { cv, patchCv, discard } = useSession();
  const [replacing, setReplacing] = useState(false), [confirm, setConfirm] = useState<"replace" | "remove" | null>(null);
  const up = cv.upload, hasWork = !!(cv.filter || cv.analysis);
  async function uploaded(res: any) {
    const old = cv.upload?.metadata.audio_id;
    patchCv({ upload: res, analysis: null, filter: null, loaded: {} }); setReplacing(false);
    if (old) { try { await del(`/api/v1/audio/${old}`); } catch { /* expired already */ } }
  }
  return (
    <WorkflowShell module="clearvoice" step="upload" title="Upload audio" nextLabel="Validate and Continue" nextDisabled={!up}
      intro="Choose a recording to analyze. The server decodes and validates the actual file content (size, duration, sample rate, channels, finite samples); a filename extension alone proves nothing.">
      {(!up || replacing) && <section className="card"><AudioUploader onUploaded={uploaded} current={up ? { name: up.file?.name ?? "recording", size: up.file?.size } : null} /></section>}
      {up && !replacing && <section className="card stack"><h3>Validated recording</h3>
        <p><b>{up.file?.name ?? "Restored recording"}</b></p>
        <p className="muted">{up.metadata.channels} channel(s) · {up.metadata.sample_rate_hz} Hz · {up.metadata.duration_s.toFixed(2)} s · decoded from {up.metadata.source_format?.toUpperCase()} ({up.metadata.sample_format})</p>
        {up.metadata.decoder_warnings?.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}
        <div className="actions"><button className="btn ghost" onClick={() => (hasWork ? setConfirm("replace") : setReplacing(true))}>Replace file</button><button className="btn danger" onClick={() => setConfirm("remove")}>Remove file</button></div></section>}
      <ConfirmDialog open={confirm === "replace"} title="Replace the audio file?" body="Your current analysis and filtered results will be discarded when the new file is uploaded." confirmLabel="Choose a new file" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); setReplacing(true); }} />
      <ConfirmDialog open={confirm === "remove"} danger title="Remove this recording?" body="The recording and all results for it are deleted from the server and from this session." confirmLabel="Remove" onCancel={() => setConfirm(null)} onConfirm={async () => { setConfirm(null); await discard("clearvoice"); setReplacing(false); }} />
    </WorkflowShell>
  );
}
