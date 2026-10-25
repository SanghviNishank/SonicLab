const THRESHOLDS = ["min_tonal_ratio", "min_tonal_fraction", "min_f0_range_hz", "min_f0_std_hz"];
export const PRE_KEYS = ["order", "nr_strength", "nr_max_db"];

export function buildSettings(defaults: any): any {
  const p = defaults.params;
  const pick = (g: string) => Object.fromEntries(Object.entries(p[g]).filter(([k]) => !PRE_KEYS.includes(k)).map(([k, v]: any) => [k, v.default]));
  return {
    sensitivity: "", features: pick("analysis"), detector: pick("detector"),
    preprocessing: { channel_mode: "mix", remove_dc: true,
      filter: { type: "none", c1: 300, c2: 3000, order: p.preprocessing.order.default, method: "zero_phase" },
      noise_reduction: { enabled: false, strength: p.preprocessing.nr_strength.default, max_reduction_db: p.preprocessing.nr_max_db.default } },
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
      noise_reduction: { enabled: s.preprocessing.noise_reduction.enabled, strength: Number(s.preprocessing.noise_reduction.strength),
        max_reduction_db: Number(s.preprocessing.noise_reduction.max_reduction_db) } },
    detect_on: s.detect_on, compare: s.compare,
  };
}

export function validate(s: any, defaults: any): string[] {
  const errs: string[] = [];
  const check = (group: string, vals: any) => {
    for (const [k, spec] of Object.entries(defaults.params[group]) as any) {
      if (!(k in vals)) continue;
      const v = Number(vals[k]);
      if (vals[k] === "" || !Number.isFinite(v) || v < spec.min || v > spec.max) errs.push(`${spec.label}: must be between ${spec.min} and ${spec.max} ${spec.unit}`.trim());
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

export function applyPreset(s: any, level: string, presets: any): any {
  if (!level) return { ...s, sensitivity: "" };
  return { ...s, sensitivity: level, detector: { ...s.detector, ...presets[level] } };
}
export function editDetector(s: any, key: string, value: string): any {
  const next = { ...s, detector: { ...s.detector, [key]: value } };
  if (THRESHOLDS.includes(key)) next.sensitivity = "";                       // editing a threshold leaves the preset
  return next;
}
