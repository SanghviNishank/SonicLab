import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatHz, formatTime } from "./format.ts";
import { cutoffsFor, validateFilter } from "./filterValidation.ts";
import { CLEARVOICE_STEPS, ROADSONIC_STEPS, blockedReason, nextStep, prevStep, redirectFor, stepStatus, type Snapshot } from "./workflow.ts";
import { applyPreset, buildSettings, editDetector, toRequest, validate } from "./roadsonicSettings.ts";
import { MAX_AGE_MS, parse, serialize } from "./session.ts";
import { DEMO_FS, butterworthLowpassDb, demoChirp, demoSpectrogram, demoSpectrum } from "./demoSignal.ts";

const empty: Snapshot = { hasUpload: false, loaded: {} };

test("format helpers", () => {
  assert.equal(formatTime(65.5), "1:05.50"); assert.equal(formatTime(-1), "–"); assert.equal(formatTime(NaN), "–");
  assert.equal(formatBytes(1536), "1.5 KB"); assert.equal(formatBytes(5 * 1024 * 1024), "5.00 MB"); assert.equal(formatHz(440), "440 Hz"); assert.equal(formatHz(2000), "2 kHz");
});

test("filter validation mirrors backend rules", () => {
  assert.deepEqual(validateFilter("lowpass", 4, [1000], 16000), []);
  assert.deepEqual(validateFilter("bandpass", 4, [500, 2000], 16000), []);
  assert.ok(validateFilter("lowpass", 4, [8000], 16000).some((m) => m.includes("Nyquist")));            // == Nyquist is invalid
  assert.ok(validateFilter("lowpass", 4, [9000], 16000).some((m) => m.includes("Nyquist")));
  assert.ok(validateFilter("bandpass", 4, [2000, 1000], 16000).some((m) => m.includes("lower cutoff")));
  assert.ok(validateFilter("bandstop", 4, [1000], 16000).length > 0);                                   // needs two cutoffs
  assert.ok(validateFilter("lowpass", 4, [-5], 16000).length > 0); assert.ok(validateFilter("lowpass", 4, [NaN], 16000).length > 0);
  assert.ok(validateFilter("lowpass", 0, [100], 16000).length > 0); assert.ok(validateFilter("lowpass", 13, [100], 16000).length > 0);
  assert.ok(validateFilter("lowpass", 2.5, [100], 16000).length > 0); assert.ok(validateFilter("notch", 4, [100], 16000).length > 0);
  assert.ok(validateFilter("lowpass", 4, [100], 0).length > 0);
  assert.deepEqual(cutoffsFor("bandstop", 1, 2), [1, 2]); assert.deepEqual(cutoffsFor("highpass", 1, 2), [1]);
});

test("ClearVoice workflow: prerequisites and redirects", () => {
  assert.equal(blockedReason("clearvoice", "upload", empty), null);
  for (const k of ["overview", "time-analysis", "frequency-analysis", "spectrogram", "filter", "comparison", "results"]) assert.ok(blockedReason("clearvoice", k, empty), k);
  const up: Snapshot = { hasUpload: true, loaded: {} };
  assert.equal(blockedReason("clearvoice", "filter", up), null); assert.ok(blockedReason("clearvoice", "comparison", up)); assert.ok(blockedReason("clearvoice", "results", up));
  const f: Snapshot = { ...up, hasFilterResult: true };
  assert.equal(blockedReason("clearvoice", "comparison", f), null); assert.equal(blockedReason("clearvoice", "results", f), null);
  assert.equal(redirectFor("clearvoice", "comparison", empty), "upload");
  assert.equal(redirectFor("clearvoice", "comparison", up), "filter");                                  // furthest legal step before it
  assert.equal(redirectFor("clearvoice", "results", f), "results");
  assert.ok(blockedReason("clearvoice", "nope", f));
});

test("RoadSonic workflow: events need a detection run", () => {
  const a: Snapshot = { hasUpload: true, hasAnalysis: true, loaded: {} };
  for (const k of ["overview", "preprocess", "features", "detect"]) assert.equal(blockedReason("roadsonic", k, a), null, k);
  for (const k of ["events", "review", "summary"]) assert.ok(blockedReason("roadsonic", k, a), k);
  assert.equal(redirectFor("roadsonic", "events", a), "detect");
  assert.equal(blockedReason("roadsonic", "events", { ...a, hasDetection: true }), null);
  assert.equal(redirectFor("roadsonic", "summary", empty), "upload");
});

test("step completion reflects data, not clicking Next", () => {
  const up: Snapshot = { hasUpload: true, loaded: {} };
  assert.equal(stepStatus("clearvoice", "upload", "overview", up), "completed");
  assert.equal(stepStatus("clearvoice", "overview", "overview", up), "current");
  assert.equal(stepStatus("clearvoice", "time-analysis", "overview", up), "not_started");              // never rendered real data yet
  assert.equal(stepStatus("clearvoice", "time-analysis", "overview", { ...up, loaded: { "time-analysis": true } }), "completed");
  assert.equal(stepStatus("clearvoice", "frequency-analysis", "overview", { ...up, loaded: { "frequency-analysis": true } }), "not_started");   // viewed but no spectrum
  assert.equal(stepStatus("clearvoice", "frequency-analysis", "overview", { ...up, hasSpectrum: true, loaded: { "frequency-analysis": true } }), "completed");
  assert.equal(stepStatus("clearvoice", "filter", "overview", up), "not_started");
  assert.equal(stepStatus("clearvoice", "filter", "overview", { ...up, hasFilterResult: true }), "completed");
  assert.equal(stepStatus("clearvoice", "comparison", "overview", up), "blocked");
  assert.equal(stepStatus("roadsonic", "detect", "events", { hasUpload: true, hasAnalysis: true, loaded: {} }), "not_started");
  assert.equal(stepStatus("roadsonic", "detect", "events", { hasUpload: true, hasAnalysis: true, hasDetection: true, loaded: {} }), "completed");
});

test("step navigation order", () => {
  assert.equal(CLEARVOICE_STEPS.length, 8); assert.equal(ROADSONIC_STEPS.length, 8);
  assert.equal(nextStep("clearvoice", "upload"), "overview"); assert.equal(prevStep("clearvoice", "upload"), null);
  assert.equal(nextStep("clearvoice", "results"), null); assert.equal(prevStep("roadsonic", "detect"), "features"); assert.equal(nextStep("roadsonic", "summary"), null);
  assert.equal(new Set(CLEARVOICE_STEPS.map((s) => s.key)).size, 8);
});

const DEFAULTS = {
  params: {
    analysis: { frame_ms: { default: 64, min: 20, max: 200, unit: "ms", label: "Frame length" }, hop_ms: { default: 16, min: 5, max: 100, unit: "ms", label: "Hop length" },
      band_lo: { default: 450, min: 100, max: 8000, unit: "Hz", label: "Band low" }, band_hi: { default: 2000, min: 200, max: 12000, unit: "Hz", label: "Band high" } },
    detector: { min_tonal_ratio: { default: 0.5, min: 0, max: 1, unit: "", label: "Tonal" }, min_tonal_fraction: { default: 0.6, min: 0.1, max: 1, unit: "", label: "Frac" },
      min_f0_range_hz: { default: 150, min: 0, max: 4000, unit: "Hz", label: "Range" }, min_f0_std_hz: { default: 40, min: 0, max: 2000, unit: "Hz", label: "Std" },
      window_s: { default: 1, min: 0.3, max: 10, unit: "s", label: "Window" }, window_step_s: { default: 0.1, min: 0.02, max: 2, unit: "s", label: "Step" },
      min_event_s: { default: 1, min: 0.2, max: 60, unit: "s", label: "Min event" } },
    preprocessing: { order: { default: 4 }, nr_strength: { default: 0.7 }, nr_max_db: { default: 18 } },
  },
  sensitivity_presets: { low: { min_tonal_ratio: 0.6, min_tonal_fraction: 0.7, min_f0_range_hz: 200, min_f0_std_hz: 55 } },
};

test("RoadSonic settings: defaults, request, validation, presets", () => {
  const s = buildSettings(DEFAULTS);
  assert.equal(s.features.frame_ms, 64); assert.equal(s.detector.min_event_s, 1); assert.ok(!("order" in s.detector));
  const r = toRequest(s);
  assert.equal(r.sensitivity, null); assert.deepEqual(r.preprocessing.filter.cutoff_hz, []); assert.equal(typeof r.features.frame_ms, "number");
  assert.deepEqual(validate(s, DEFAULTS), []);
  const bad = { ...s, features: { ...s.features, hop_ms: "80", frame_ms: "50" } }; assert.ok(validate(bad, DEFAULTS).some((m) => m.includes("Hop")));
  assert.ok(validate({ ...s, features: { ...s.features, frame_ms: "5" } }, DEFAULTS).some((m) => m.includes("Frame length")));
  assert.ok(validate({ ...s, features: { ...s.features, frame_ms: "" } }, DEFAULTS).length > 0);                 // empty string must not pass as 0
  assert.ok(validate({ ...s, features: { ...s.features, band_lo: "3000", band_hi: "2000" } }, DEFAULTS).length > 0);
  const bp = { ...s, preprocessing: { ...s.preprocessing, filter: { ...s.preprocessing.filter, type: "bandpass", c1: 3000, c2: 1000 } } };
  assert.ok(validate(bp, DEFAULTS).some((m) => m.includes("Band-pass"))); assert.deepEqual(toRequest(bp).preprocessing.filter.cutoff_hz, [3000, 1000]);
  const p = applyPreset(s, "low", DEFAULTS.sensitivity_presets); assert.equal(p.sensitivity, "low"); assert.equal(p.detector.min_f0_range_hz, 200); assert.equal(toRequest(p).sensitivity, "low");
  assert.equal(editDetector(p, "min_f0_range_hz", "180").sensitivity, ""); assert.equal(editDetector(p, "min_event_s", "2").sensitivity, "low");
  assert.equal(applyPreset(p, "", {}).sensitivity, "");
});

test("session persistence stores ids only and rejects bad/expired data", () => {
  const id = "a".repeat(32), now = 1_000_000_000;
  const raw = serialize({ module: "clearvoice", audioId: id, filename: "x.wav" }, now);
  assert.ok(!raw.includes("samples")); assert.equal(parse(raw, "clearvoice", now + 1000)?.audioId, id);
  assert.equal(parse(raw, "roadsonic", now + 1000), null);                                           // wrong module
  assert.equal(parse(raw, "clearvoice", now + MAX_AGE_MS + 1), null);                                // expired
  assert.equal(parse(raw, "clearvoice", now - 10 * 60_000), null);                                   // clock in the future
  assert.equal(parse("{not json", "clearvoice"), null); assert.equal(parse(null, "clearvoice"), null);
  assert.equal(parse(JSON.stringify({ v: 1, module: "clearvoice", audioId: "../../etc/passwd", savedAt: now }), "clearvoice", now), null);   // not a server id
});

test("demo signal generators are numerically correct", () => {
  const { t, y } = demoChirp(1); assert.equal(y.length, DEMO_FS); assert.ok(Math.abs(t[1] - 1 / DEMO_FS) < 1e-12); assert.ok(y.every(Number.isFinite));
  const n = 1024, fs = 8000, k0 = 64, x = Array.from({ length: n }, (_, i) => 0.8 * Math.sin((2 * Math.PI * k0 * fs * i) / (n * fs)));        // bin-centred 500 Hz
  const sp = demoSpectrum(x, fs, n), kmax = sp.a.indexOf(Math.max(...sp.a));
  assert.equal(sp.f[kmax], 500); assert.ok(Math.abs(sp.a[kmax] - 0.8) < 0.01);                       // calibrated amplitude
  assert.equal(sp.f[sp.f.length - 1], fs / 2);
  const f = [0, 1000, 2000], db = butterworthLowpassDb(f, 1000, 4);
  assert.ok(Math.abs(db[0]) < 1e-12); assert.ok(Math.abs(db[1] + 3.0103) < 1e-3); assert.ok(db[2] < -24);
  const g = demoSpectrogram(demoChirp(0.5).y, DEMO_FS, 256, 128);
  assert.equal(g.z.length, g.f.length); assert.equal(g.z[0].length, g.t.length); assert.equal(g.f[g.f.length - 1], DEMO_FS / 2); assert.ok(Math.abs(g.t[0] - 128 / DEMO_FS) < 1e-12);
});
