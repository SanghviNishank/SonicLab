import { useEffect, useMemo, useState } from "react";
import WorkflowShell from "../../components/workflow/WorkflowShell";
import { FilterResponseChart } from "../../components/charts";
import { ErrorPanel, ProcessingStatus } from "../../components/ui";
import { useSession } from "../../context/Session";
import { call, isAborted, postJson } from "../../api";
import { cutoffsFor, validateFilter, MAX_ORDER, MIN_ORDER } from "../../logic/filterValidation.ts";

function DigitalFilter({ fs, id }: { fs: number; id: string }) {
  const { cv, patchCv } = useSession();
  const [f, setF] = useState({ type: "lowpass", order: 4, c1: 1000, c2: 3000, method: "zero_phase" });
  const [preview, setPreview] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const two = f.type === "bandpass" || f.type === "bandstop", cutoffs = cutoffsFor(f.type, Number(f.c1), Number(f.c2)), errors = validateFilter(f.type, Number(f.order), cutoffs, fs);
  const key = JSON.stringify({ k: "filter", ...f, c1: Number(f.c1), c2: two ? Number(f.c2) : null });
  const stale = cv.filter?.requestKey !== key;
  useEffect(() => {                                    // live theoretical response, debounced; invalid settings are never sent
    setPreview(null); if (errors.length) return;
    const ctl = new AbortController();                 // a newer setting cancels the older request: a slow stale response cannot overwrite it
    const t = setTimeout(() => postJson(`/api/v1/clearvoice/${id}/filter/preview`, { filter_type: f.type, order: Number(f.order), cutoff_hz: cutoffs, method: f.method }, ctl.signal).then(setPreview).catch((e) => { if (!isAborted(e)) setErr(e.message); }), 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key]);                                           // eslint-disable-line react-hooks/exhaustive-deps
  async function apply() {
    if (errors.length) return; setBusy(true); setErr("");
    try { const result = await postJson(`/api/v1/clearvoice/${id}/filter`, { filter_type: f.type, order: Number(f.order), cutoff_hz: cutoffs, method: f.method }); patchCv({ filter: { kind: "filter", requestKey: key, label: `${f.type} ${cutoffs.join("–")} Hz, order ${f.order}, ${f.method}`, result } }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="layout-split">
      <div className="stack">
        {preview ? <FilterResponseChart response={preview.response} cutoffs={cutoffs} fs={fs} /> : <section className="card"><p className="muted">{errors.length ? "Fix the settings to see the response." : "Designing filter…"}</p></section>}
        {preview && <section className="card"><h3>Expected attenuation at the cutoff</h3><p>{preview.attenuation_at_cutoff.map((a: any) => `${a.frequency_hz} Hz: ${a.magnitude_db.toFixed(2)} dB`).join(" · ")}</p><p className="muted">{preview.explanation}</p>
          <p className="muted"><b>Passband</b>: frequencies passed almost unchanged. <b>Stopband</b>: strongly attenuated. <b>Transition band</b>: the slope between them; higher order makes it steeper but rings more. Forward-backward (zero-phase) filtering is noncausal (it uses future samples), squares the magnitude response and cannot be used in real time.</p></section>}
      </div>
      <aside className="card stack" aria-label="Filter settings"><h3>Filter settings</h3>
        <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="lowpass">Low-pass</option><option value="highpass">High-pass</option><option value="bandpass">Band-pass</option><option value="bandstop">Band-stop / notch</option></select></label>
        <label>{two ? "Lower cutoff (Hz)" : "Cutoff (Hz)"}<input type="number" min={1} value={f.c1} onChange={(e) => setF({ ...f, c1: e.target.value as any })} /></label>
        {two && <label>Upper cutoff (Hz)<input type="number" min={1} value={f.c2} onChange={(e) => setF({ ...f, c2: e.target.value as any })} /></label>}
        <label>Order ({MIN_ORDER}–{MAX_ORDER})<input type="number" min={MIN_ORDER} max={MAX_ORDER} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value as any })} /></label>
        <label>Method<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="zero_phase">Zero-phase (forward-backward)</option><option value="causal">Causal (single pass)</option></select></label>
        <p className="muted mono">Nyquist = {fs / 2} Hz · normalized cutoff = {cutoffs.map((c) => (c / (fs / 2)).toFixed(4)).join(", ")}</p>
        {errors.length > 0 && <ul className="error" role="alert">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <button className="btn" disabled={busy || errors.length > 0} onClick={apply}>{busy ? "Applying…" : cv.filter?.kind === "filter" && !stale ? "Re-apply filter" : "Apply Filter"}</button>
        {busy && <ProcessingStatus label="Filtering every channel of the original samples…" />}{err && <ErrorPanel message={err} />}
        {cv.filter?.kind === "filter" && <p className={"chip " + (stale ? "warn" : "ok")} role="status">{stale ? "● Settings changed - apply again" : "✓ Applied"}</p>}
      </aside>
    </div>
  );
}

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
        <button role="tab" aria-selected={tab === "filter"} onClick={() => setTab("filter")}>Digital filter</button><button role="tab" aria-selected={tab === "voice"} onClick={() => setTab("voice")}>Voice enhancement</button></div>
      {tab === "filter" ? <DigitalFilter fs={up.metadata.sample_rate_hz} id={up.metadata.audio_id} /> : <VoicePanel id={up.metadata.audio_id} />}
      {r && <section className="card stack"><h3>Latest result: {cv.filter.label}</h3><p className="muted">Processed in {r.processing_s?.toFixed(2)} s · engine {r.config?.engine ?? "python-scipy"}</p>
        {r.warnings?.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}
        {r.quality && <p className={r.quality.ok ? "ok" : "error"} role="status">{r.quality.ok ? "✓ Output checks passed" : "✖ Output checks failed"} · peak {r.quality.peak.toFixed(3)} · clipped samples {r.quality.clipped_samples}</p>}
        <p className="muted">Open the comparison to hear and see the difference.</p></section>}
    </WorkflowShell>
  );
}
