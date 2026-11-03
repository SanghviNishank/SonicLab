import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatDetail, formatHz, formatTime } from "./format.ts";
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

test("formatDetail turns FastAPI validation lists into readable text", async () => {
  assert.equal(formatDetail("plain message"), "plain message");
  assert.equal(formatDetail([{ loc: ["body", "overrides", "rumble", "cutoff_hz"], msg: "Input should be a valid number" }]),
    "overrides.rumble.cutoff_hz: Input should be a valid number");
  assert.equal(formatDetail(undefined, "fallback"), "fallback");
});

test("filter regions are derived from the measured response", async () => {
  const { classifyResponse, describeRegions } = await import("./filterRegions.ts");
  const f = [0, 100, 200, 300, 400, 500], m = [0, -1, -10, -30, -50, -80];
  const r = classifyResponse(f, m);
  assert.deepEqual(r.map((x) => x.kind), ["pass", "transition", "stop"]);
  assert.equal(r[0].f1, 200); assert.equal(r[2].f1, 500);
  assert.equal(classifyResponse([0, 1], [-4, -4], -6)[0].kind, "pass");     // -6 dB threshold for zero-phase
  assert.deepEqual(classifyResponse([0], [0]), []);
  assert.match(describeRegions(r), /passband 0–200 Hz; transition band 200–400 Hz; stopband 400–500 Hz/);
});

test("player keyboard map and clamp", async () => {
  const { actionForKey, clamp } = await import("./playerKeys.ts");
  assert.deepEqual(actionForKey(" "), { type: "toggle" });
  assert.deepEqual(actionForKey("ArrowLeft"), { type: "seek", delta: -5 });
  assert.deepEqual(actionForKey("ArrowRight", true), { type: "seek", delta: 1 });
  assert.deepEqual(actionForKey("m"), { type: "mute" });
  assert.equal(actionForKey("x"), null);
  assert.equal(clamp(9, 0, 5), 5); assert.equal(clamp(-1, 0, 5), 0);
});

test("metadata rows: known values formatted, unknown values never invented", async () => {
  const { metadataRows } = await import("./metadata.ts");
  const full = metadataRows({ metadata: { source_format: "WAV", sample_format: "PCM_16", decoded_dtype: "float64", file_size_bytes: 2048, sample_rate_hz: 16000, duration_s: 1.5, samples_per_channel: 24000, channels: 2 },
    statistics: { per_channel: [{ peak_abs: 0.5, rms: 0.1 }, { peak_abs: 0.7, rms: 0.05 }] } }, "a.wav");
  const get = (l: string) => full.find((r) => r.label === l)!;
  assert.equal(get("File size").value, "2.0 KB"); assert.equal(get("Peak amplitude").value, "0.7000"); assert.equal(get("Samples / channel").value, "24,000");
  assert.ok(full.every((r) => r.known));
  const empty = metadataRows({ metadata: { sample_rate_hz: NaN }, statistics: { per_channel: [{ peak_abs: null }] } });
  assert.ok(["File size", "Sample rate", "Peak amplitude", "RMS", "Format"].every((l) => empty.find((r) => r.label === l)!.value === "not calculated"));
});

test("studio helpers", async () => {
  const s = await import("./studio.ts");
  assert.equal(s.needsResync(1, 1.1), false); assert.equal(s.needsResync(1, 1.2), true);
  assert.equal(s.comparableDuration(10, 9.5), 9.5); assert.equal(s.comparableDuration(0, 3), 3); assert.equal(s.comparableDuration(NaN, NaN), 0);
  assert.equal(s.normalizeSection(1, 3, 10).section?.end, 3);
  assert.ok(s.normalizeSection(5, 4, 10).error); assert.ok(s.normalizeSection(0, 11, 10).error); assert.ok(s.normalizeSection(1, 1.1, 10).error);
  assert.equal(s.sectionAction(2.9, { start: 1, end: 3 }, true), "none"); assert.equal(s.sectionAction(3, { start: 1, end: 3 }, true), "loop");
  assert.equal(s.sectionAction(3.1, { start: 1, end: 3 }, false), "stop"); assert.equal(s.sectionAction(99, null, true), "none");
  assert.equal(s.fmtDb(null), "n/a");
  const rows = s.levelRows({ original: { channels: [{ rms: 0.2, peak: 0.5, rms_dbfs: -13.98, peak_dbfs: -6.02, clipped_samples: 0 }] }, processed: { channels: [{ rms: 0.1, peak: 0.4, rms_dbfs: -20, peak_dbfs: -7.96, clipped_samples: 0 }] } });
  assert.equal(rows.length, 3); assert.equal(rows[0].change, "-6.0 dB"); assert.equal(rows[2].change, "0");
  assert.equal(s.processedUrl("http://h", "j1", true), "http://h/api/v1/clearvoice/j1/download?match_loudness=true");
  assert.equal(s.processedUrl("http://h", "j1", false), "http://h/api/v1/clearvoice/j1/download");
});

test("filter lab maps UI to the backend request and validates", async () => {
  const L = await import("./filterLab.ts");
  const base = L.DEFAULT_LAB;
  assert.deepEqual(L.toBackend({ ...base, type: "lowpass", f1: 800 }), { filter_type: "lowpass", cutoff_hz: [800], method: "zero_phase", order: 4 });
  assert.deepEqual(L.toBackend({ ...base, type: "bandpass", f1: 300, f2: 3400, zeroPhase: false }), { filter_type: "bandpass", cutoff_hz: [300, 3400], method: "causal", order: 4 });
  assert.deepEqual(L.toBackend({ ...base, type: "notch", centre: 1000, bandwidth: 100 }).cutoff_hz, [950, 1050]);
  assert.equal(L.toBackend({ ...base, type: "notch" }).filter_type, "bandstop");
  assert.deepEqual(L.validateLab(base, 16000), []);
  assert.ok(L.validateLab({ ...base, type: "highpass", f1: 9000 }, 16000).length);
  assert.ok(L.validateLab({ ...base, type: "notch", centre: 50, bandwidth: 200 }, 16000).length);          // lower edge would be negative
  assert.ok(L.validateLab({ ...base, type: "notch", centre: 7990, bandwidth: 100 }, 16000).length);        // upper edge above Nyquist
  assert.ok(L.validateLab({ ...base, type: "bandpass", f1: 3000, f2: 1000 }, 16000).length);
  assert.ok(L.validateLab({ ...base, order: 13 }, 16000).length);
  for (const hz of [20, 100, 1000, 7840]) assert.ok(Math.abs(L.sliderToHz(L.hzToSlider(hz, 16000), 16000) - hz) / hz < 0.02);
  assert.equal(L.sliderToHz(0, 16000), 20); assert.ok(L.sliderToHz(1000, 16000) < 8000);
  const a = { freqs_hz: [0, 100, 200, 300], magnitude_db: [0, -3, -20, -40] }, b = { freqs_hz: [0, 150, 300], magnitude_db: [0, -11.5, -40] };
  assert.ok((L.maxResponseDifferenceDb(a, a) ?? 1) < 1e-12); assert.ok((L.maxResponseDifferenceDb(a, b) ?? 0) > 1);
  assert.equal(L.maxResponseDifferenceDb({ freqs_hz: [0, 1], magnitude_db: [0, 0] }, { freqs_hz: [5, 6], magnitude_db: [0, 0] }), null);
  const sm = L.retainedSummary([{ kind: "pass", f0: 0, f1: 900 }, { kind: "transition", f0: 900, f1: 1500 }, { kind: "stop", f0: 1500, f1: 8000 }]);
  assert.equal(sm.kept, "0–900 Hz"); assert.equal(sm.reduced, "1500–8000 Hz");
});

test("DSP demo helpers are numerically correct", async () => {
  const D = await import("./dspDemo.ts");
  const fs = 8000, n = 1024, f = 125 * 8;            // bin-centred: 1000 Hz = bin 128
  const sp = D.amplitudeSpectrum(D.sine(f, 0.5, fs, n), fs);
  const k = sp.amp.indexOf(Math.max(...sp.amp)); assert.ok(Math.abs(sp.freqs[k] - 1000) < 1e-9); assert.ok(Math.abs(sp.amp[k] - 0.5) < 0.01);
  const two = D.amplitudeSpectrum(D.add(D.sine(500, 0.3, fs, n), D.sine(1500, 0.2, fs, n)), fs);
  const top = [...two.amp.keys()].sort((a, b) => two.amp[b] - two.amp[a]).slice(0, 2).map((i) => Math.round(two.freqs[i])).sort((a, b) => a - b);
  assert.deepEqual(top, [500, 1500]);
  assert.throws(() => D.fftInPlace(new Float64Array(6), new Float64Array(6)));
  assert.equal(D.aliasFrequency(900, 1000), 100); assert.equal(D.aliasFrequency(300, 1000), 300); assert.equal(D.aliasFrequency(1100, 1000), 100);
  assert.equal(D.isAliased(600, 1000), true); assert.equal(D.isAliased(500, 1000), false);
});

test("learning facts come only from the session and lessons never invent values", async () => {
  const { buildFacts } = await import("./learnFacts.ts");
  const { LESSONS } = await import("../features/learn/lessons.ts");
  const none = buildFacts({ upload: null }, { upload: null });
  assert.equal(none.source, null);
  assert.ok(LESSONS.every((l) => l.yours(none) === null || l.id === "never"), "no personal sentence without a recording");
  const cv = { upload: { file: { name: "a.wav" }, metadata: { sample_rate_hz: 44100, channels: 1, duration_s: 2, samples_per_channel: 88200 }, statistics: { per_channel: [{ peak_abs: 0.5, rms: 0.1 }] } },
    analysis: { spectrum: { window: "hann", bin_spacing_hz: 0.5, peaks: [{ frequency_hz: 1396.5, amplitude: 0.02 }] } },
    filter: { label: "x", result: { config: { filter_type: "highpass", cutoff_hz: [200], order: 4, method: "zero_phase" }, metrics: { per_channel: [{ rms_before: 0.1, rms_after: 0.08 }] } } } };
  const f = buildFacts(cv, { upload: null });
  const by = (id: string) => LESSONS.find((l) => l.id === id)!.yours(f)!;
  assert.match(by("rate"), /44,100 samples per second/); assert.match(by("nyquist"), /22050 Hz/); assert.match(by("fft"), /1396.5 Hz/);
  assert.match(by("amplitude"), /0\.5/); assert.match(by("rms"), /0\.1.*0\.08.*0\.1/); assert.match(by("filter"), /high-pass filter with a cutoff of 200 Hz.*rumble/);
  assert.match(by("snr"), /does not report an SNR/); assert.match(by("noise"), /not applied noise reduction/);
  assert.equal(LESSONS.length, 13); assert.ok(LESSONS.every((l) => l.why && l.beginner.length && l.technical.length));
  const rs = buildFacts({ upload: null }, { upload: cv.upload, res: { spectrum: cv.analysis.spectrum }, detected: true });
  assert.equal(rs.source, "roadsonic"); assert.equal(rs.filter, undefined);
});

test("presentation steps and availability", async () => {
  const P = await import("../features/presentation/steps.ts");
  assert.equal(P.CLEARVOICE_STEPS.length, 9); assert.equal(P.ROADSONIC_STEPS.length, 9);
  assert.deepEqual(P.CLEARVOICE_STEPS.map((s) => s.title), ["Introduction", "Upload", "Waveform", "Frequency analysis", "Filtering", "Processing", "Audio comparison", "Results", "Conclusion"]);
  const none = { hasUpload: false, hasAnalysis: false, hasFilter: false, hasDetection: false };
  const cmp = P.CLEARVOICE_STEPS.find((s) => s.id === "comparison")!;
  assert.deepEqual(P.stepReady(cmp, none), { ready: false, missing: "Upload a recording first." });
  assert.equal(P.stepReady(cmp, { ...none, hasUpload: true }).missing, "Apply a filter to the recording first.");
  assert.equal(P.stepReady(cmp, { ...none, hasUpload: true, hasFilter: true }).ready, true);
  assert.equal(P.stepReady(P.CLEARVOICE_STEPS[0], none).ready, true);
  assert.equal(P.clampStep(-3, 9), 0); assert.equal(P.clampStep(99, 9), 8); assert.equal(P.progressLabel(2, 9), "Step 3 of 9");
  const ev = P.ROADSONIC_STEPS.find((s) => s.id === "events")!, f0 = { source: "roadsonic" as const, peaks: [], hasSpectra: false, hasSpectrogram: false };
  assert.match(ev.say({ ...f0, events: 0 }), /no candidate events.*does not prove/); assert.match(ev.say({ ...f0, events: 2 }), /2 candidate events/); assert.doesNotMatch(ev.say(f0), /flagged/);
  assert.ok([...P.CLEARVOICE_STEPS, ...P.ROADSONIC_STEPS].every((s) => s.say(f0).length > 40 && !/\b(siren (was|is) detected|noise (was|has been) removed)\b/i.test(s.say(f0))));
});
