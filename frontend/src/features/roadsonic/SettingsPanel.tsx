import { useState } from "react";

import { applyPreset, buildSettings, editDetector, toRequest, validate } from "../../logic/roadsonicSettings.ts";
export { buildSettings, toRequest, validate };
const stepFor = (max: number) => (max <= 1 ? 0.05 : max <= 10 ? 0.1 : 1);

function Field({ spec, name, value, onChange }: { spec: any; name: string; value: any; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = `rs-${name}`;
  return (
    <div className="rs-field">
      <label htmlFor={id} title={spec.help}>{spec.label}{spec.unit ? ` (${spec.unit})` : ""}
        <button type="button" className="rs-info" aria-expanded={open} aria-label={`Explain ${spec.label}`} onClick={() => setOpen(!open)}>ⓘ</button></label>
      <input id={id} type="number" min={spec.min} max={spec.max} step={stepFor(spec.max)} value={value} onChange={(e) => onChange(e.target.value)} />
      <input type="range" aria-hidden="true" tabIndex={-1} min={spec.min} max={spec.max} step={stepFor(spec.max)} value={Number(value)} onChange={(e) => onChange(e.target.value)} />
      <span className="muted">default {spec.default}</span>
      {open && <p className="rs-help">{spec.help}</p>}
    </div>
  );
}

export default function SettingsPanel({ defaults, s, setS, dirty, busy, hasAudio, onRun, onReset, sections = ["sensitivity", "analysis", "detector", "preprocessing"], runLabel, embedded }:
  { defaults: any; s: any; setS: (x: any) => void; dirty: boolean; busy: boolean; hasAudio: boolean; onRun: () => void; onReset: () => void; sections?: string[]; runLabel?: string; embedded?: boolean }) {
  const show = (k: string) => sections.includes(k);
  const errs = validate(s, defaults);
  const setGroup = (g: "features" | "detector", k: string, v: string) => setS(g === "detector" ? editDetector(s, k, v) : { ...s, features: { ...s.features, [k]: v } });
  const setPre = (patch: any) => setS({ ...s, preprocessing: { ...s.preprocessing, ...patch } });
  const f = s.preprocessing.filter, nr = s.preprocessing.noise_reduction;
  const preset = (lvl: string) => setS(applyPreset(s, lvl, defaults.sensitivity_presets));
  const render = (group: string, g: "features" | "detector", skip: string[] = []) =>
    Object.entries(defaults.params[group]).filter(([k]) => !skip.includes(k)).map(([k, spec]: any) =>
      <Field key={k} name={k} spec={spec} value={s[g][k]} onChange={(v) => setGroup(g, k, v)} />);
  return (
    <aside className={"rs-settings" + (embedded ? " embedded" : "")} aria-label="Detection settings">
      <div className="rs-settings-head">
        <h2>Detection settings</h2>
        <span className={"rs-chip " + (dirty ? "warn" : "ok")} role="status">{dirty ? "● Settings changed - rerun needed" : "✓ Matches last run"}</span>
      </div>
      {show("sensitivity") && <details open><summary>Sensitivity</summary>
        <label>Preset<select value={s.sensitivity} onChange={(e) => preset(e.target.value)}>
          <option value="">Custom (use the values below)</option><option value="low">Low - stricter</option><option value="medium">Medium - recommended</option><option value="high">High - more permissive</option></select></label>
        <p className="muted">{defaults.sensitivity_note}</p>
      </details>}
      {show("analysis") && <details open><summary>Analysis</summary><div className="rs-fields">{render("analysis", "features")}</div></details>}
      {show("detector") && <details open><summary>Detector rules</summary><div className="rs-fields">{render("detector", "detector")}</div></details>}
      {show("preprocessing") && <details open><summary>Preprocessing (optional)</summary>
        <p className="muted">Filtering can remove useful siren harmonics or modulation. The original recording is never modified.</p>
        <div className="rs-fields">
          <label>Channels<select value={s.preprocessing.channel_mode} onChange={(e) => setPre({ channel_mode: e.target.value })}>
            <option value="mix">Mix to mono (average)</option><option value="0">Left only</option><option value="1">Right only</option></select></label>
          <label className="inline"><input type="checkbox" checked={s.preprocessing.remove_dc} onChange={(e) => setPre({ remove_dc: e.target.checked })} /> Remove DC offset</label>
          <label>Filter<select value={f.type} onChange={(e) => setPre({ filter: { ...f, type: e.target.value } })}>
            <option value="none">None</option><option value="highpass">High-pass</option><option value="lowpass">Low-pass</option><option value="bandpass">Band-pass</option></select></label>
          {f.type !== "none" && <>
            <label>{f.type === "bandpass" ? "Low cutoff (Hz)" : "Cutoff (Hz)"}<input type="number" min={1} value={f.c1} onChange={(e) => setPre({ filter: { ...f, c1: e.target.value } })} /></label>
            {f.type === "bandpass" && <label>High cutoff (Hz)<input type="number" min={1} value={f.c2} onChange={(e) => setPre({ filter: { ...f, c2: e.target.value } })} /></label>}
            <label>Order (1-8)<input type="number" min={1} max={8} value={f.order} onChange={(e) => setPre({ filter: { ...f, order: e.target.value } })} /></label>
            <label>Method<select value={f.method} onChange={(e) => setPre({ filter: { ...f, method: e.target.value } })}>
              <option value="zero_phase">Zero-phase (noncausal)</option><option value="causal">Causal</option></select></label></>}
          <label className="inline"><input type="checkbox" checked={nr.enabled} onChange={(e) => setPre({ noise_reduction: { ...nr, enabled: e.target.checked } })} /> Adaptive noise reduction</label>
          {nr.enabled && <>
            <label>Strength (0-1)<input type="number" min={0} max={1} step={0.1} value={nr.strength} onChange={(e) => setPre({ noise_reduction: { ...nr, strength: e.target.value } })} /></label>
            <label>Max reduction (dB)<input type="number" min={1} max={30} value={nr.max_reduction_db} onChange={(e) => setPre({ noise_reduction: { ...nr, max_reduction_db: e.target.value } })} /></label></>}
          <label>Detect on<select value={s.detect_on} onChange={(e) => setS({ ...s, detect_on: e.target.value })}>
            <option value="auto">Auto (processed if preprocessing is on)</option><option value="original">Original (mix + DC only)</option><option value="processed">Processed</option></select></label>
          <label className="inline"><input type="checkbox" checked={s.compare} onChange={(e) => setS({ ...s, compare: e.target.checked })} /> Also run the other version for comparison</label>
        </div>
      </details>}
      {errs.length > 0 && <ul className="error" role="alert">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="actions">
        <button className="btn" disabled={busy || !hasAudio || errs.length > 0} onClick={onRun}>{busy ? "Analyzing…" : dirty ? "Rerun analysis" : "Run analysis"}</button>
        <button className="btn ghost" disabled={busy} onClick={onReset}>Reset to defaults</button>
      </div>
      {!hasAudio && <p className="muted">Upload a recording to enable analysis.</p>}
    </aside>
  );
}
