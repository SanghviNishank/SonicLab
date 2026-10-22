import { useState } from "react";

const THRESHOLDS = ["min_tonal_ratio", "min_tonal_fraction", "min_f0_range_hz", "min_f0_std_hz"];
const stepFor = (max: number) => (max <= 1 ? 0.05 : max <= 10 ? 0.1 : 1);

export function buildSettings(defaults: any): any {
  const p = defaults.params;
  const pick = (g: string) => Object.fromEntries(Object.entries(p[g]).filter(([k]) => !["order", "nr_strength", "nr_max_db"].includes(k)).map(([k, v]: any) => [k, v.default]));
  return {
    sensitivity: "",
    features: pick("analysis"), detector: pick("detector"),
    preprocessing: {
      channel_mode: "mix", remove_dc: true,
      filter: { type: "none", c1: 300, c2: 3000, order: p.preprocessing.order.default, method: "zero_phase" },
      noise_reduction: { enabled: false, strength: p.preprocessing.nr_strength.default, max_reduction_db: p.preprocessing.nr_max_db.default },
    },
    detect_on: "auto", compare: true,
  };
}

export function toRequest(s: any): any {
  const f = s.preprocessing.filter;
  const cutoff = f.type === "none" ? [] : f.type === "bandpass" ? [Number(f.c1), Number(f.c2)] : [Number(f.c1)];
  const num = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
  return {
    sensitivity: s.sensitivity || null, features: num(s.features), detector: num(s.detector),
    preprocessing: { channel_mode: s.preprocessing.channel_mode, remove_dc: s.preprocessing.remove_dc,
      filter: { type: f.type, cutoff_hz: cutoff, order: Number(f.order), method: f.method },
      noise_reduction: { enabled: s.preprocessing.noise_reduction.enabled, strength: Number(s.preprocessing.noise_reduction.strength), max_reduction_db: Number(s.preprocessing.noise_reduction.max_reduction_db) } },
    detect_on: s.detect_on, compare: s.compare,
  };
}

export function validate(s: any, defaults: any): string[] {
  const errs: string[] = [];
  const check = (group: string, vals: any) => {
    for (const [k, spec] of Object.entries(defaults.params[group]) as any) {
      if (!(k in vals)) continue;
      const v = Number(vals[k]);
      if (!Number.isFinite(v) || v < spec.min || v > spec.max) errs.push(`${spec.label}: must be between ${spec.min} and ${spec.max} ${spec.unit}`);
    }
  };
  check("analysis", s.features); check("detector", s.detector);
  if (Number(s.features.hop_ms) > Number(s.features.frame_ms)) errs.push("Hop length must not exceed frame length");
  if (Number(s.features.band_lo) >= Number(s.features.band_hi)) errs.push("Band low edge must be below band high edge");
  if (Number(s.detector.window_step_s) > Number(s.detector.window_s)) errs.push("Window step must not exceed the decision window");
  const f = s.preprocessing.filter;
  if (f.type !== "none" && !(Number(f.c1) > 0)) errs.push("Filter cutoff must be a positive number of Hz");
  if (f.type === "bandpass" && !(Number(f.c1) < Number(f.c2))) errs.push("Band-pass needs low cutoff < high cutoff");
  return errs;
}

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

export default function SettingsPanel({ defaults, s, setS, dirty, busy, hasAudio, onRun, onReset }:
  { defaults: any; s: any; setS: (x: any) => void; dirty: boolean; busy: boolean; hasAudio: boolean; onRun: () => void; onReset: () => void }) {
  const errs = validate(s, defaults);
  const setGroup = (g: "features" | "detector", k: string, v: string) => {
    const next = { ...s, [g]: { ...s[g], [k]: v } };
    if (g === "detector" && THRESHOLDS.includes(k)) next.sensitivity = "";      // editing a threshold leaves the preset
    setS(next);
  };
  const setPre = (patch: any) => setS({ ...s, preprocessing: { ...s.preprocessing, ...patch } });
  const f = s.preprocessing.filter, nr = s.preprocessing.noise_reduction;
  const preset = (lvl: string) => {
    if (!lvl) return setS({ ...s, sensitivity: "" });
    setS({ ...s, sensitivity: lvl, detector: { ...s.detector, ...defaults.sensitivity_presets[lvl] } });
  };
  const render = (group: string, g: "features" | "detector", skip: string[] = []) =>
    Object.entries(defaults.params[group]).filter(([k]) => !skip.includes(k)).map(([k, spec]: any) =>
      <Field key={k} name={k} spec={spec} value={s[g][k]} onChange={(v) => setGroup(g, k, v)} />);
  return (
    <aside className="rs-settings" aria-label="Detection settings">
      <div className="rs-settings-head">
        <h2>Detection settings</h2>
        <span className={"rs-chip " + (dirty ? "warn" : "ok")} role="status">{dirty ? "● Settings changed - rerun needed" : "✓ Matches last run"}</span>
      </div>
      <details open><summary>Sensitivity</summary>
        <label>Preset<select value={s.sensitivity} onChange={(e) => preset(e.target.value)}>
          <option value="">Custom (use the values below)</option><option value="low">Low - stricter</option><option value="medium">Medium - recommended</option><option value="high">High - more permissive</option></select></label>
        <p className="muted">{defaults.sensitivity_note}</p>
      </details>
      <details open><summary>Analysis</summary><div className="rs-fields">{render("analysis", "features")}</div></details>
      <details open><summary>Detector rules</summary><div className="rs-fields">{render("detector", "detector")}</div></details>
      <details><summary>Preprocessing (optional)</summary>
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
      </details>
      {errs.length > 0 && <ul className="error" role="alert">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="actions">
        <button className="btn" disabled={busy || !hasAudio || errs.length > 0} onClick={onRun}>{busy ? "Analyzing…" : dirty ? "Rerun analysis" : "Run analysis"}</button>
        <button className="btn ghost" disabled={busy} onClick={onReset}>Reset to defaults</button>
      </div>
      {!hasAudio && <p className="muted">Upload a recording to enable analysis.</p>}
    </aside>
  );
}
