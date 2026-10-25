export type ModuleId = "clearvoice" | "roadsonic";
export type StepStatus = "not_started" | "current" | "completed" | "blocked";
export interface Step { key: string; label: string; short: string; optional?: boolean }

export const CLEARVOICE_STEPS: Step[] = [
  { key: "upload", label: "Upload audio", short: "Upload" }, { key: "overview", label: "Audio overview", short: "Overview" },
  { key: "time-analysis", label: "Time-domain analysis", short: "Time" }, { key: "frequency-analysis", label: "Frequency-domain analysis", short: "Spectrum" },
  { key: "spectrogram", label: "Spectrogram", short: "Spectrogram" }, { key: "filter", label: "Digital filter", short: "Filter" },
  { key: "comparison", label: "Original vs filtered", short: "Compare" }, { key: "results", label: "Results and export", short: "Results" },
];
export const ROADSONIC_STEPS: Step[] = [
  { key: "upload", label: "Upload traffic audio", short: "Upload" }, { key: "overview", label: "Traffic audio overview", short: "Overview" },
  { key: "preprocess", label: "Optional preprocessing", short: "Preprocess", optional: true }, { key: "features", label: "Feature analysis", short: "Features" },
  { key: "detect", label: "Candidate siren detection", short: "Detect" }, { key: "events", label: "Event timeline", short: "Events" },
  { key: "review", label: "Event review", short: "Review", optional: true }, { key: "summary", label: "Summary and evaluation", short: "Summary" },
];
export const STEPS: Record<ModuleId, Step[]> = { clearvoice: CLEARVOICE_STEPS, roadsonic: ROADSONIC_STEPS };

/** What the session actually holds. Completion is derived from this data, never from clicking Next. */
export interface Snapshot {
  hasUpload: boolean;
  hasSpectrum?: boolean; hasSpectrogram?: boolean; hasFilterResult?: boolean;      // ClearVoice
  hasAnalysis?: boolean; hasDetection?: boolean;                                    // RoadSonic
  loaded: Record<string, boolean>;                                                  // screens that rendered real data successfully
}

const NEEDS: Record<ModuleId, Record<string, (s: Snapshot) => string | null>> = {
  clearvoice: {
    upload: () => null,
    overview: (s) => (s.hasUpload ? null : "Upload and validate an audio file first."),
    "time-analysis": (s) => (s.hasUpload ? null : "Upload and validate an audio file first."),
    "frequency-analysis": (s) => (s.hasUpload ? null : "Upload and validate an audio file first."),
    spectrogram: (s) => (s.hasUpload ? null : "Upload and validate an audio file first."),
    filter: (s) => (s.hasUpload ? null : "Upload and validate an audio file first."),
    comparison: (s) => (!s.hasUpload ? "Upload and validate an audio file first." : s.hasFilterResult ? null : "Apply a filter first."),
    results: (s) => (!s.hasUpload ? "Upload and validate an audio file first." : s.hasFilterResult ? null : "Apply a filter first."),
  },
  roadsonic: {
    upload: () => null,
    overview: (s) => (s.hasAnalysis ? null : "Upload and validate a recording first."),
    preprocess: (s) => (s.hasAnalysis ? null : "Upload and validate a recording first."),
    features: (s) => (s.hasAnalysis ? null : "Upload and validate a recording first."),
    detect: (s) => (s.hasAnalysis ? null : "Upload and validate a recording first."),
    events: (s) => (!s.hasAnalysis ? "Upload and validate a recording first." : s.hasDetection ? null : "Run candidate detection first."),
    review: (s) => (!s.hasAnalysis ? "Upload and validate a recording first." : s.hasDetection ? null : "Run candidate detection first."),
    summary: (s) => (!s.hasAnalysis ? "Upload and validate a recording first." : s.hasDetection ? null : "Run candidate detection first."),
  },
};

/** null = may enter; otherwise the reason it is blocked. */
export function blockedReason(m: ModuleId, key: string, s: Snapshot): string | null {
  const f = NEEDS[m][key];
  return f ? f(s) : "Unknown step.";
}

function dataReady(m: ModuleId, key: string, s: Snapshot): boolean {
  if (m === "clearvoice") {
    switch (key) {
      case "upload": case "overview": case "time-analysis": return s.hasUpload;
      case "frequency-analysis": return !!s.hasSpectrum;
      case "spectrogram": return !!s.hasSpectrogram;
      default: return !!s.hasFilterResult;
    }
  }
  switch (key) {
    case "upload": return s.hasUpload;
    case "overview": case "preprocess": case "features": return !!s.hasAnalysis;
    default: return !!s.hasDetection;
  }
}

export function stepStatus(m: ModuleId, key: string, current: string, s: Snapshot): StepStatus {
  if (blockedReason(m, key, s)) return "blocked";
  if (key === current) return "current";
  const needsViewing = !["upload", "filter", "detect"].includes(key);                 // processing steps complete when their result exists
  const done = dataReady(m, key, s) && (!needsViewing || !!s.loaded[key]);
  return done ? "completed" : "not_started";
}

export function stepIndex(m: ModuleId, key: string): number { return STEPS[m].findIndex((x) => x.key === key); }
export function nextStep(m: ModuleId, key: string): string | null { const i = stepIndex(m, key); return i >= 0 && i < STEPS[m].length - 1 ? STEPS[m][i + 1].key : null; }
export function prevStep(m: ModuleId, key: string): string | null { const i = stepIndex(m, key); return i > 0 ? STEPS[m][i - 1].key : null; }

/** Where to send a user who opened a blocked URL: the last step they may legally enter before it. */
export function redirectFor(m: ModuleId, key: string, s: Snapshot): string {
  const steps = STEPS[m]; let target = steps[0].key;
  for (let i = 0; i < Math.max(0, stepIndex(m, key)); i++) if (!blockedReason(m, steps[i].key, s)) target = steps[i].key;
  return blockedReason(m, key, s) ? target : key;
}
