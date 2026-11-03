import { useEffect, useMemo, useState } from "react";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import VisualFilterLab from "../../features/filterlab/VisualFilterLab";
import { ErrorPanel, ProcessingStatus } from "../../components/ui";
import { useSession } from "../../context/Session";
import { call, isAborted, postJson } from "../../api";

function VoicePanel({ id }: { id: string }) {
  const { cv, patchCv } = useSession();
  const [presets, setPresets] = useState<Record<string, string>>({}), [preset, setPreset] = useState("lecture_speech"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [adv, setAdv] = useState({ on: false, method: "wiener", strength: 0.7, reduction: 18, gate: true, hp: 80 });
  useEffect(() => { call("/api/v1/clearvoice/presets").then((r) => setPresets(r.presets)).catch((e) => setErr(e.message)); }, []);
  const overrides = useMemo(() => adv.on ? { dc_removal: { enabled: true }, rumble: { enabled: true, cutoff_hz: Number(adv.hp), order: 4 },
    noise_reduction: { enabled: true, method: adv.method, strength: Number(adv.strength), max_reduction_db: Number(adv.reduction) }, speech_gate: { enabled: adv.gate, attenuation_db: 10 } } : {}, [adv]);
  const key = JSON.stringify({ k: "voice", preset, overrides }), stale = cv.filter?.requestKey !== key;
  async function apply() {
    setBusy(true); setErr("");
    try { const result = await postJson(`/api/v1/clearvoice/${id}/voice`, { preset, overrides }); patchCv({ filter: { kind: "voice", requestKey: key, label: `voice preset ${preset}${adv.on ? " + overrides" : ""}`, result } }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="card stack"><h3>Voice enhancement pipeline</h3>
      <div className="banner caution">These stages reduce steady or slowly varying noise and low-frequency rumble. They <b>cannot</b> remove music or other talkers and cannot identify one speaker. Subjective quality is not measured.</div>
      <div className="form"><label>Preset<select value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.keys(presets).map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></label></div>
      <p className="muted">{presets[preset] ?? "Loading presets…"}</p>
      <label className="inline"><input type="checkbox" checked={adv.on} onChange={(e) => setAdv({ ...adv, on: e.target.checked })} /> Advanced: override the preset</label>
      {adv.on && <div className="form"><label>Noise-reduction method<select value={adv.method} onChange={(e) => setAdv({ ...adv, method: e.target.value })}><option value="wiener">Adaptive Wiener</option><option value="gate">Spectral gate</option></select></label>
        <label>Strength (0–1)<input type="number" step={0.1} min={0} max={1} value={adv.strength} onChange={(e) => setAdv({ ...adv, strength: +e.target.value })} /></label>
        <label>Max reduction (dB)<input type="number" min={1} max={40} value={adv.reduction} onChange={(e) => setAdv({ ...adv, reduction: +e.target.value })} /></label>
        <label>Rumble high-pass (Hz)<input type="number" min={20} max={400} value={adv.hp} onChange={(e) => setAdv({ ...adv, hp: +e.target.value })} /></label>
        <label className="inline"><input type="checkbox" checked={adv.gate} onChange={(e) => setAdv({ ...adv, gate: e.target.checked })} /> Attenuate non-speech by 10 dB</label></div>}
      <div className="actions"><button className="btn" disabled={busy} onClick={apply}>{busy ? "Processing…" : "Run voice pipeline"}</button>
        {cv.filter?.kind === "voice" && <span className={"chip " + (stale ? "warn" : "ok")} role="status">{stale ? "● Settings changed - run again" : "✓ Applied"}</span>}</div>
      {busy && <ProcessingStatus label="Running the voice pipeline on the original samples…" />}{err && <ErrorPanel message={err} />}</section>
  );
}

export default function FilterStep() {
  const { cv } = useSession(), up = cv.upload, [tab, setTab] = useState<"filter" | "voice">(cv.filter?.kind === "voice" ? "voice" : "filter"), r = cv.filter?.result;
  return (
    <WorkflowShell module="clearvoice" step="filter" title="Process the audio" nextLabel="Compare results" nextDisabled={!r}
      intro="Design a classical digital filter, or run the voice pipeline. Processing always starts from the original samples; the original is never modified.">
      <div className="tabs" role="tablist" aria-label="Processing mode">
        <button role="tab" aria-selected={tab === "filter"} onClick={() => setTab("filter")}>Visual Filter Lab</button><button role="tab" aria-selected={tab === "voice"} onClick={() => setTab("voice")}>Voice enhancement</button></div>
      {tab === "filter" ? <VisualFilterLab fs={up.metadata.sample_rate_hz} id={up.metadata.audio_id} /> : <VoicePanel id={up.metadata.audio_id} />}
      {r && <section className="card stack"><h3>Latest result: {cv.filter.label}</h3><p className="muted">Processed in {r.processing_s?.toFixed(2)} s · engine {r.config?.engine ?? "python-scipy"}</p>
        {r.warnings?.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}
        {r.quality && <p className={r.quality.ok ? "ok" : "error"} role="status">{r.quality.ok ? "✓ Output checks passed" : "✖ Output checks failed"} · peak {r.quality.peak.toFixed(3)} · clipped samples {r.quality.clipped_samples}</p>}
        <p className="muted">Open the comparison to hear and see the difference.</p></section>}
    </WorkflowShell>
  );
}
