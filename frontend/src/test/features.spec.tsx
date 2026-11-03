import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../components/Plot", () => ({ default: (p: any) => <div data-testid="plot" data-title={p.title}><pre>{JSON.stringify({ shapes: p.layout?.shapes?.length ?? 0 })}</pre></div> }));
vi.mock("../components/hero/HeroVisual", () => ({ default: () => null }));

import * as api from "../api";
import { SessionProvider, useSession } from "../context/Session";
import BeforeAfterStudio from "../features/studio/BeforeAfterStudio";
import VisualFilterLab from "../features/filterlab/VisualFilterLab";
import LearnPage from "../pages/LearnPage";
import ProcessingReport from "../features/report/ProcessingReport";
import PresentationHost from "../features/presentation/PresentationHost";
import { presentation } from "../features/presentation/state";

const wave = { channels: [{ t: [0, 1, 2], y: [0, 0.5, 0] }] };
const lv = { sample_rate: 16000, original: { duration_s: 10, samples_per_channel: 160000, channels: [{ rms: 0.2, peak: 0.6, mean: 0, clipped_samples: 0, rms_dbfs: -13.98, peak_dbfs: -4.4 }] },
  processed: { duration_s: 10, samples_per_channel: 160000, channels: [{ rms: 0.1, peak: 0.4, mean: 0, clipped_samples: 3, rms_dbfs: -20, peak_dbfs: -8 }] }, duration_difference_s: 0, same_length: true,
  loudness_match_gain_db: 6.02, peak_after_loudness_match: 0.8, notes: ["Clipped = samples within 0.1 % of full scale."], waveform_difference: wave };
const upload = { metadata: { audio_id: "A1", sample_rate_hz: 16000, channels: 1, duration_s: 10, samples_per_channel: 160000, file_size_bytes: 320044, source_format: "WAV", sample_format: "PCM_16" },
  statistics: { per_channel: [{ peak_abs: 0.6, rms: 0.2, mean: 0 }], warnings: [] }, waveform: wave, file: { name: "talk.wav" } };
const spectrum = { window: "hann", freqs_hz: [0, 100, 200], amplitude: [0, 0.2, 0.01], peaks: [{ frequency_hz: 100, amplitude: 0.2 }], bin_spacing_hz: 0.1 };
const filterResult = { job_id: "J1", processing_s: 0.12, waveform_original: wave, waveform_filtered: wave, spectrum_original: spectrum, spectrum_filtered: spectrum,
  response: { freqs_hz: [0, 500, 1000, 2000], magnitude_db: [0, -1, -6, -50], effective: "|H|^2 (forward-backward)", phase_deg: [0, 0, 0, 0] },
  config: { filter_type: "lowpass", cutoff_hz: [1000], order: 4, method: "zero_phase" }, metrics: { per_channel: [{ rms_before: 0.2, rms_after: 0.1, rms_change_db: -6, mse: 0.01 }] } };

/** Puts a recording (and optionally a filter result) into the real SessionProvider, as the app would. */
function Seed({ cv, rs, children }: { cv?: any; rs?: any; children: React.ReactNode }) {
  const { patchCv, patchRs } = useSession(); useEffect(() => { if (cv) patchCv(cv); if (rs) patchRs(rs); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children}</>;
}
const wrap = (ui: React.ReactNode, cv?: any, rs?: any) => render(<MemoryRouter><SessionProvider><Seed cv={cv} rs={rs}>{ui}</Seed></SessionProvider></MemoryRouter>);
const mockCall = (map: Record<string, any>) => vi.spyOn(api, "call").mockImplementation(async (p: string) => { const k = Object.keys(map).find((x) => p.includes(x)); if (!k) throw new Error("unexpected " + p); const v = map[k]; if (v instanceof Error) throw v; return v; });

describe("Before vs After Studio", () => {
  const setup = async () => {
    mockCall({ "/levels": lv });
    const r = render(<BeforeAfterStudio audioId="A1" jobId="J1" fs={16000} waveOriginal={wave} waveProcessed={wave} settingsLabel="lowpass 1000 Hz" config={{ method: "zero_phase" }} />);
    const o = screen.getByTestId("audio-original") as HTMLAudioElement, p = screen.getByTestId("audio-processed") as HTMLAudioElement;
    for (const a of [o, p]) Object.defineProperty(a, "duration", { configurable: true, value: 10 });
    fireEvent.loadedMetadata(o); fireEvent.loadedMetadata(p);
    await screen.findByText("Measured levels"); await screen.findByText(/Ch 0 RMS/);
    return { o, p, r };
  };
  it("plays the real original and the backend-generated processed file, in sync", async () => {
    const { o, p } = await setup();
    expect(o.getAttribute("src")).toContain("/api/v1/audio/A1/file");
    expect(p.getAttribute("src")).toContain("/api/v1/clearvoice/J1/download");
    expect(p.getAttribute("src")).not.toContain("match_loudness");
    await userEvent.click(screen.getByRole("button", { name: /Compare Audio/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Pause both/ })).toBeInTheDocument());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    // drift: processed player is 1 s behind -> it is pulled back to the original's position on the next time update
    o.currentTime = 4; p.currentTime = 3; fireEvent.timeUpdate(o);
    expect(p.currentTime).toBe(4);
  });
  it("switches between original and processed and mutes the inactive one", async () => {
    const { o, p } = await setup();
    await waitFor(() => expect(o.muted).toBe(false)); expect(p.muted).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Switch between original and processed" }));
    await waitFor(() => expect(p.muted).toBe(false)); expect(o.muted).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /A · Original/ })); await waitFor(() => expect(o.muted).toBe(false));
  });
  it("loudness matching is optional and loads the backend-scaled copy; it is off by default", async () => {
    const { p } = await setup();
    const box = screen.getByRole("checkbox", { name: /Loudness-matched/ }); expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(p.getAttribute("src")).toContain("match_loudness=true"));
    expect(screen.getByText(/gain 6.02 dB/)).toBeInTheDocument();
  });
  it("validates the listening section and shows measured levels, clipping and duration", async () => {
    await setup();
    const [start, end] = screen.getAllByRole("spinbutton");
    await userEvent.type(start, "2"); await userEvent.type(end, "50"); await userEvent.click(screen.getByRole("button", { name: "Use section" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/within 0 and 10.00 s/);
    await userEvent.clear(end); await userEvent.type(end, "5"); await userEvent.click(screen.getByRole("button", { name: "Use section" }));
    expect(screen.getByText(/Section 2.00–5.00 s/)).toBeInTheDocument();
    const t = screen.getByRole("table"); expect(within(t).getByText("Ch 0 clipped samples").parentElement).toHaveTextContent("0");
    expect(within(t).getByText("Ch 0 clipped samples").parentElement).toHaveTextContent("3");
    expect(within(t).getByText("Duration").parentElement).toHaveTextContent("10.000 s");
    expect(screen.getByText(/no improvement is claimed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download processed WAV/ })).toHaveAttribute("href", expect.stringContaining("/api/v1/clearvoice/J1/download"));
  });
  it("reports a playback failure instead of silently doing nothing", async () => {
    const { p } = await setup();
    fireEvent.error(p);
    expect(await screen.findByText(/processed recording could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Compare Audio/ })).toBeDisabled();
  });
  it("shows an error, not invented numbers, when the levels request fails", async () => {
    mockCall({ "/levels": new Error("job expired") });
    render(<BeforeAfterStudio audioId="A1" jobId="J1" fs={16000} waveOriginal={wave} waveProcessed={wave} settingsLabel="x" config={{}} />);
    expect(await screen.findByText(/Levels unavailable: job expired/)).toBeInTheDocument();
  });
  it("warns when the two files have different lengths", async () => {
    mockCall({ "/levels": lv });
    render(<BeforeAfterStudio audioId="A1" jobId="J1" fs={16000} waveOriginal={wave} waveProcessed={wave} settingsLabel="x" config={{}} />);
    const o = screen.getByTestId("audio-original"), p = screen.getByTestId("audio-processed");
    Object.defineProperty(o, "duration", { configurable: true, value: 10 }); Object.defineProperty(p, "duration", { configurable: true, value: 9.5 });
    fireEvent.loadedMetadata(o); fireEvent.loadedMetadata(p);
    expect(await screen.findByText(/differ in length by 0.500 s/)).toBeInTheDocument();
  });
});

describe("Visual Filter Lab", () => {
  const preview = { response: { freqs_hz: [0, 500, 1000, 2000], magnitude_db: [0, -1, -6, -50], effective: "|H|^2 (forward-backward)", phase_deg: [0, 0, 0, 0] }, attenuation_at_cutoff: [{ frequency_hz: 1000, magnitude_db: -6.02 }], explanation: "x" };
  it("offers all five filter types and sends the validated design to the backend preview", async () => {
    const post = vi.spyOn(api, "postJson").mockResolvedValue(preview);
    wrap(<VisualFilterLab fs={16000} id="A1" />, { upload });
    for (const n of ["Low-pass", "High-pass", "Band-pass", "Band-stop", "Notch"]) expect(screen.getByRole("radio", { name: new RegExp(n) })).toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/clearvoice/A1/filter/preview", expect.objectContaining({ filter_type: "lowpass", cutoff_hz: [1000], order: 4, method: "zero_phase" }), expect.anything()));
    await userEvent.click(screen.getByRole("radio", { name: /Notch/ }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ filter_type: "bandstop", cutoff_hz: [950, 1050] }), expect.anything()));
    expect(await screen.findByText("Retained")).toBeInTheDocument(); expect(screen.getByText("Reduced")).toBeInTheDocument();
  });
  it("blocks invalid settings: no preview request and Apply is disabled", async () => {
    const post = vi.spyOn(api, "postJson").mockResolvedValue(preview);
    wrap(<VisualFilterLab fs={16000} id="A1" />, { upload });
    await waitFor(() => expect(post).toHaveBeenCalled()); post.mockClear();
    const cutoff = screen.getByLabelText("Cutoff frequency in hertz"); await userEvent.clear(cutoff); await userEvent.type(cutoff, "9000");   // above Nyquist (8000)
    expect(await screen.findByRole("alert")).toHaveTextContent(/Nyquist|below/i);
    expect(screen.getByRole("button", { name: /Apply Filter/ })).toBeDisabled();
    await new Promise((r) => setTimeout(r, 250)); expect(post).not.toHaveBeenCalled();
  });
  it("Apply Filter sends the same design to the real filter endpoint and shows the applied settings", async () => {
    const post = vi.spyOn(api, "postJson").mockImplementation(async (p: string) => (p.endsWith("/filter/preview") ? preview : filterResult));
    wrap(<VisualFilterLab fs={16000} id="A1" />, { upload });
    await screen.findByText("Retained");
    await userEvent.click(screen.getByRole("button", { name: /Apply Filter/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/clearvoice/A1/filter", { filter_type: "lowpass", order: 4, cutoff_hz: [1000], method: "zero_phase" }));
    const applied = await screen.findByLabelText("Applied filter settings");
    expect(applied).toHaveTextContent("lowpass"); expect(applied).toHaveTextContent("1000"); expect(applied).toHaveTextContent(/consistent/);
    expect(screen.getByRole("button", { name: "Open Before vs After Studio" })).toBeInTheDocument();
  });
  it("shows a backend error from Apply without a result", async () => {
    vi.spyOn(api, "postJson").mockImplementation(async (p: string) => { if (p.endsWith("/filter/preview")) return preview; throw new Error("busy, retry"); });
    wrap(<VisualFilterLab fs={16000} id="A1" />, { upload });
    await screen.findByText("Retained"); await userEvent.click(screen.getByRole("button", { name: /Apply Filter/ }));
    expect(await screen.findByText(/busy, retry/)).toBeInTheDocument(); expect(screen.queryByLabelText("Applied filter settings")).toBeNull();
  });
});

describe("DSP Learning Assistant", () => {
  it("lists the 13 lessons and explains the user's actual recording", async () => {
    wrap(<LearnPage />, { upload: { ...upload, metadata: { ...upload.metadata, sample_rate_hz: 44100 } }, analysis: { spectrum } });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(13);
    await userEvent.click(screen.getByRole("button", { name: /What is sampling rate/ }));
    expect(await screen.findByText("Your recording uses 44,100 samples per second. This means the computer measured the sound 44,100 times every second.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /What is the FFT/ }));
    expect(await screen.findByText(/strong frequency components around 100 Hz/)).toBeInTheDocument();
    expect(screen.getByText("Why does this matter?")).toBeInTheDocument();
  });
  it("shows no measurements when nothing is uploaded, and never an example value", async () => {
    wrap(<LearnPage />);
    expect(screen.getByText(/No recording is loaded/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /What is sampling rate/ }));
    expect(await screen.findByText(/Upload a recording to see this explained/)).toBeInTheDocument();
    expect(screen.queryByText(/44,100/)).toBeNull(); expect(screen.queryByText(/16,000/)).toBeNull();
  });
  it("switches between beginner and technical explanations", async () => {
    wrap(<LearnPage />);
    await userEvent.click(screen.getByRole("button", { name: /What is the Nyquist/ }));
    expect(screen.getByText(/highest pitch a recording can safely hold/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Technical" }));
    expect(await screen.findByText(/aliasing/)).toBeInTheDocument();
  });
  it("does not invent an SNR", async () => {
    wrap(<LearnPage />, { upload });
    await userEvent.click(screen.getByRole("button", { name: /What is SNR/ }));
    expect(await screen.findByText(/does not report an SNR for your recording/)).toBeInTheDocument();
  });
});

describe("Processing Report", () => {
  const rep = { generated: "2026-01-01T00:00:00Z", software: { app: "SignalSystem", app_version: "9", engine: "python-scipy", python: "3", numpy: "2", scipy: "1" },
    recording: { filename: "talk.wav", sample_rate_hz: 16000, channels: 1, duration_s: 10, file_size_bytes: null },
    analysis: { channels: [{ channel: 0, rms: 0.2, peak: 0.6, mean: 0 }], dominant_peaks_original: [{ frequency_hz: 100, amplitude: 0.2 }], frequency_note: "peaks are estimates" },
    processing: { kind: "digital_filter", config: { filter_type: "highpass", cutoff_hz: [80], order: 4, method: "zero_phase" }, noise_reduction: { applied: false, note: "No noise-reduction stage was applied in this session." }, processing_s: 0.123 },
    comparison: { per_channel: [{ channel: 0, rms_before: 0.2, rms_after: 0.1, peak_before: 0.6, peak_after: 0.4, clipped_before: 0, clipped_after: 3 }], notes: ["n"] },
    explanation: "A high-pass Butterworth filter of order 4 was applied.", limitations: ["Filtering cannot recover information that was never recorded."], reproducibility: { note: "Re-running reproduces this." } };
  it("renders the six sections from the backend report with real parameters and export links", async () => {
    mockCall({ "/processing-report": rep });
    render(<ProcessingReport jobId="J1" result={filterResult} fs={16000} />);
    expect(await screen.findByText("1. Recording information")).toBeInTheDocument();
    for (const h of ["2. Audio analysis", "3. Processing information", "4. Before and after comparison", "5. Processing explanation", "6. Limitations"]) expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("highpass")).toBeInTheDocument(); expect(screen.getByText("80 Hz")).toBeInTheDocument(); expect(screen.getByText("0.123 s")).toBeInTheDocument();
    expect(screen.getByText("not calculated")).toBeInTheDocument();                                    // file size was null: never replaced by a guess
    expect(screen.getByRole("link", { name: "Download PDF report" })).toHaveAttribute("href", expect.stringContaining("/clearvoice/J1/report?format=pdf"));
    expect(screen.getByRole("link", { name: "Download processing summary" })).toHaveAttribute("href", expect.stringContaining("format=summary"));
    expect(screen.getByRole("link", { name: "Processed WAV" })).toHaveAttribute("href", expect.stringContaining("/clearvoice/J1/download"));
  });
  it("shows an error with retry when the report cannot be built", async () => {
    mockCall({ "/processing-report": new Error("result expired") });
    render(<ProcessingReport jobId="J1" result={filterResult} fs={16000} />);
    expect(await screen.findByText(/result expired/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Presentation Mode", () => {
  const open = (m: "clearvoice" | "roadsonic" | null, cv?: any, rs?: any) => { wrap(<PresentationHost />, cv, rs); act(() => presentation.start(m)); };
  it("starts with a chooser and walks the 9 ClearVoice steps with Back/Next/Restart/Exit", async () => {
    open(null, { upload });
    expect(await screen.findByRole("heading", { name: "Choose a presentation" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ClearVoice: analysis and filtering/ }));
    expect(await screen.findByRole("heading", { name: "Introduction" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Back/ })).toBeDisabled();
    expect(screen.getByRole("complementary", { name: "What to say" })).toHaveTextContent(/laboratory for audio/);
    await userEvent.click(screen.getByRole("button", { name: /Next/ })); await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByRole("heading", { name: "Waveform" })).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 9")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "What to say" })).toHaveTextContent("The horizontal axis represents time");
    fireEvent.keyDown(window, { key: "ArrowRight" }); expect(await screen.findByRole("heading", { name: "Frequency analysis" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Restart/ })); expect(await screen.findByText("Step 1 of 9")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Exit presentation" })); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the uploaded recording when the presentation is closed", async () => {
    function Probe() { const { cv } = useSession(); return <p data-testid="probe">{cv.upload?.file?.name ?? "none"}</p>; }
    wrap(<><Probe /><PresentationHost /></>, { upload }); act(() => presentation.start("clearvoice"));
    await userEvent.click(await screen.findByRole("button", { name: "Exit presentation" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("talk.wav");
  });
  it("never fabricates results: steps that need data say what is missing", async () => {
    open("clearvoice"); await screen.findByRole("heading", { name: "Introduction" });
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: /Next/ }));      // -> Filtering (index 4)
    for (let i = 0; i < 2; i++) await userEvent.click(screen.getByRole("button", { name: /Next/ }));      // -> Audio comparison
    expect(await screen.findByRole("heading", { name: "Audio comparison" })).toBeInTheDocument();
    expect(screen.getAllByText(/Upload a recording first\./).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("audio-original")).toBeNull();
  });
  it("RoadSonic sequence has 9 steps and does not claim a detection before one is run", async () => {
    open("roadsonic", undefined, { upload });
    expect(await screen.findByText("Step 1 of 9")).toBeInTheDocument();
    for (let i = 0; i < 6; i++) await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByRole("heading", { name: "Candidate siren events" })).toBeInTheDocument();
    expect(screen.getByText(/Candidate detection has not been run yet/)).toBeInTheDocument();
    expect(screen.queryByText(/siren (was|is) detected/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Next/ })); await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByRole("heading", { name: "Limitations and future scope" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });
  it("Escape exits", async () => { open("clearvoice"); await screen.findByRole("dialog"); fireEvent.keyDown(window, { key: "Escape" }); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); });
});
