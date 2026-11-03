import { hz, num, type Facts } from "../../logic/learnFacts.ts";

export type ModuleKey = "clearvoice" | "roadsonic";
export type Stage = "intro" | "upload" | "waveform" | "frequency" | "spectrogram" | "filtering" | "processing" | "comparison" | "results" | "features" | "events" | "evidence" | "limits" | "conclusion";
export type Need = "none" | "upload" | "analysis" | "filter" | "detect";
export interface PStep { id: Stage; title: string; need: Need; simple: string; say: (f: Facts) => string }

const file = (f: Facts) => (f.fileName ? `“${f.fileName}”` : "the recording");
export const CLEARVOICE_STEPS: PStep[] = [
  { id: "intro", title: "Introduction", need: "none", simple: "ClearVoice lets you look inside a recording and try to reduce unwanted sound.",
    say: () => "ClearVoice is a laboratory for audio. We load a recording, look at it in time and in frequency, apply a digital filter, and then compare the original with the processed version using both measurements and listening." },
  { id: "upload", title: "Upload", need: "upload", simple: "This is the recording we are analysing.",
    say: (f) => f.fs ? `We are analysing ${file(f)}. It lasts ${f.durationS?.toFixed(2)} seconds, has ${f.channels} channel${(f.channels ?? 1) > 1 ? "s" : ""}, and the computer measured it ${num(f.fs)} times per second.` : "First we upload the recording to analyse. Nothing is analysed until a real file is loaded." },
  { id: "waveform", title: "Waveform", need: "upload", simple: "Time runs left to right; the height is the strength of the sound.",
    say: () => "Here, we are looking at the waveform. The horizontal axis represents time, and the vertical axis represents the strength of the audio signal. This helps us understand how the sound changes during the recording." },
  { id: "frequency", title: "Frequency analysis", need: "analysis", simple: "The FFT shows which pitches are in the sound and how strong each is.",
    say: (f) => f.peaks.length ? `The FFT splits the sound into its frequencies. The tallest peaks in this recording are near ${f.peaks.slice(0, 3).map((p) => hz(p.f)).join(", ")}. A peak tells us there is energy at that frequency; it does not by itself tell us whether it is voice or noise.` : "The FFT splits the sound into its frequencies. A peak tells us there is energy at that frequency; it does not by itself tell us whether it is voice or noise." },
  { id: "filtering", title: "Filtering", need: "none", simple: "A filter is a gate for frequencies: some pass, some are reduced.",
    say: (f) => f.filter?.kind === "filter" ? `Think of a filter as a gate for frequencies. For this demonstration we used a ${f.filter.type} filter with cutoff ${(f.filter.cutoff ?? []).map(hz).join(" and ")}. Frequencies it keeps pass through; the others are turned down.` : "Think of a filter as a gate for frequencies. Some pass through and others are turned down. We choose the type and the cutoff, and the response graph shows exactly what will be kept." },
  { id: "processing", title: "Processing", need: "filter", simple: "The filter is applied to the real recording on the server.",
    say: (f) => f.filter ? `The filter was applied to the real samples of ${file(f)} on the server; the original is never changed. ${f.rmsBefore !== undefined && f.rmsAfter !== undefined ? "The average level (RMS) moved from " + f.rmsBefore.toFixed(4) + " to " + f.rmsAfter.toFixed(4) + ", which only tells us energy was removed." : ""}` : "We now apply the filter to the real recording. The original is never changed." },
  { id: "comparison", title: "Audio comparison", need: "filter", simple: "Listen to the original, then the processed version.",
    say: () => "Listen to the original recording first. Now listen to the processed recording. Notice whether the unwanted background sound has decreased while the voice remains clear. We judge this by listening, not by a number." },
  { id: "results", title: "Results", need: "filter", simple: "Measured changes, and what they do not prove.",
    say: () => "These are the measured changes in level and spectrum. A lower RMS does not automatically mean better audio, and we do not claim an SNR improvement because we have no clean reference. The limits matter as much as the results." },
  { id: "conclusion", title: "Conclusion", need: "none", simple: "What the project achieved.",
    say: () => "To conclude: we built an application that loads real audio, analyses it in time and frequency, applies a validated Butterworth filter on a backend, and lets us compare the result by listening and measurement. Filtering reduces chosen frequency ranges; it is not magic, and its limits are stated in the report." },
];

export const ROADSONIC_STEPS: PStep[] = [
  { id: "intro", title: "Introduction", need: "none", simple: "RoadSonic looks for sounds that might be emergency sirens in traffic audio.",
    say: () => "RoadSonic is an academic prototype that looks for sounds that might be emergency sirens in traffic recordings. It does not decide that a siren is present; it reports candidate events and the evidence behind them." },
  { id: "upload", title: "Upload traffic audio", need: "upload", simple: "This is the traffic recording being analysed.",
    say: (f) => f.fs ? `We are analysing ${file(f)}, ${f.durationS?.toFixed(2)} seconds long, sampled at ${num(f.fs)} Hz.` : "First we upload a traffic recording. Nothing is analysed until a real file is loaded." },
  { id: "waveform", title: "Waveform", need: "analysis", simple: "How loud the traffic audio is over time.",
    say: () => "The horizontal axis is time and the vertical axis is signal strength. A siren is not obvious here, because traffic noise hides it. That is why we look at frequency next." },
  { id: "frequency", title: "Frequency analysis", need: "analysis", simple: "Which pitches dominate the whole recording.",
    say: (f) => f.peaks.length ? `The spectrum shows which pitches dominate the recording. Strong peaks appear near ${f.peaks.slice(0, 3).map((p) => hz(p.f)).join(", ")}. Horns, engines and speech also make peaks, so a peak alone does not mean a siren.` : "The spectrum shows which pitches dominate. Horns, engines and speech also make peaks, so a peak alone does not mean a siren." },
  { id: "spectrogram", title: "Spectrogram", need: "analysis", simple: "Pitch over time: a siren draws a moving line.",
    say: () => "The spectrogram shows pitch over time. A siren that rises and falls tends to draw a curved line, but music and alarms can look similar, so we treat it as evidence, not proof." },
  { id: "features", title: "Audio features", need: "analysis", simple: "Numbers measured in every short frame of the recording.",
    say: () => "For each short frame we measure features such as the dominant frequency, how tonal the sound is, and its level. The detector's rules look at how these features behave over time." },
  { id: "events", title: "Candidate siren events", need: "detect", simple: "Time ranges that met the detector's rules.",
    say: (f) => f.events === undefined ? "After we run the detector it lists time ranges that met its rules. They are candidates only." : f.events === 0 ? "The detector found no candidate events with these settings. That does not prove that no siren is present." : `The detector flagged ${f.events} candidate event${f.events > 1 ? "s" : ""}. They are candidates only: the rules fired, which is not the same as a confirmed siren.` },
  { id: "evidence", title: "Detection evidence", need: "detect", simple: "Why each time range was flagged.",
    say: () => "For every candidate we show the evidence: how long the tone lasted, how steady or sweeping its frequency was, and which rules passed. The score is a heuristic, not a probability." },
  { id: "limits", title: "Limitations and future scope", need: "none", simple: "What this prototype cannot do yet.",
    say: () => "Limitations: the rules are hand-written, the detector has not been validated as a safety system, and horns, alarms or music can trigger false alarms while weak or distant sirens can be missed. Future work: evaluating on labelled recordings and comparing with a learned model." },
];

export const stepsFor = (m: ModuleKey) => (m === "clearvoice" ? CLEARVOICE_STEPS : ROADSONIC_STEPS);
export const clampStep = (i: number, n: number) => Math.max(0, Math.min(n - 1, Math.trunc(Number.isFinite(i) ? i : 0)));
export const progressLabel = (i: number, n: number) => `Step ${clampStep(i, n) + 1} of ${n}`;

export interface Avail { hasUpload: boolean; hasAnalysis: boolean; hasFilter: boolean; hasDetection: boolean }
/** Whether a step's real data exists yet. "none" steps are always ready; others report what is missing so the stage can say so instead of inventing a result. */
export function stepReady(step: PStep, a: Avail): { ready: boolean; missing: string } {
  const miss: Record<Need, [boolean, string]> = { none: [true, ""], upload: [a.hasUpload, "Upload a recording first."], analysis: [a.hasAnalysis, a.hasUpload ? "Run the analysis first." : "Upload a recording first."],
    filter: [a.hasFilter, a.hasUpload ? "Apply a filter to the recording first." : "Upload a recording first."], detect: [a.hasDetection, a.hasUpload ? "Run candidate detection first." : "Upload a recording first."] };
  const [ok, msg] = miss[step.need]; return { ready: ok, missing: ok ? "" : msg };
}
