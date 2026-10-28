import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../components/hero/HeroVisual", () => ({ default: () => <div data-testid="hero-visual" /> }));
vi.mock("../components/hero/FeaturePreview", () => ({ default: () => <div /> }));
vi.mock("../components/Plot", () => ({ default: (p: any) => <div data-testid="plot" data-title={p.title}>{p.summary && <span>{p.summary}</span>}<pre data-testid={`layout-${p.title}`}>{JSON.stringify(p.layout)}</pre></div> }));

import HomePage from "../pages/HomePage";
import { MetadataPanel } from "../components/ui";
import AudioPlayer from "../components/audio/AudioPlayer";
import AudioUploader from "../components/audio/AudioUploader";
import { FilterResponseChart } from "../components/charts";
import { SessionProvider } from "../context/Session";
import { StepGuard } from "../components/workflow/WorkflowShell";
import * as api from "../api";

describe("landing page", () => {
  const renderHome = () => render(<MemoryRouter><HomePage /></MemoryRouter>);
  it("shows the required headline, subtext and calls to action", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Understand Every Signal. Hear What Matters.");
    expect(screen.getByText("An interactive audio intelligence laboratory for digital signal analysis, intelligent filtering, and emergency siren detection in noisy environments.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enter Audio Lab/ })).toHaveAttribute("href", "#labs");
    expect(screen.getByRole("link", { name: /Explore the Technology/ })).toHaveAttribute("href", "#technology");
  });
  it("links each module card to its own upload step", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /Open ClearVoice Lab/ })).toHaveAttribute("href", "/clearvoice/upload");
    expect(screen.getByRole("link", { name: /Open RoadSonic Lab/ })).toHaveAttribute("href", "/roadsonic/upload");
  });
  it("labels the hero as an illustration and states the academic-prototype limits", () => {
    renderHome();
    expect(screen.getByText(/Illustration: the 3D ribbon is decorative/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Limitations and academic use/ })).toBeInTheDocument();
    expect(screen.getByText(/has not been validated as a safety system/)).toBeInTheDocument();
  });
});

describe("MetadataPanel", () => {
  it("shows measured values and marks missing ones as not calculated", () => {
    render(<MetadataPanel fileName="a.wav" upload={{ metadata: { sample_rate_hz: 16000, duration_s: 2, samples_per_channel: 32000, channels: 1, source_format: "WAV" }, statistics: { per_channel: [{ peak_abs: 0.5, rms: 0.1 }] } }} />);
    expect(screen.getByText("16000 Hz")).toBeInTheDocument();
    expect(screen.getByText("0.5000")).toBeInTheDocument();
    expect(screen.getByText("File size").parentElement).toHaveTextContent("not calculated");     // backend did not send file_size_bytes
    expect(screen.getByText(/x\[n\] = x\(n·Ts\)/)).toBeInTheDocument();
  });
});

describe("AudioPlayer", () => {
  const setup = () => {
    const { container } = render(<AudioPlayer src="blob:x" label="Test clip" />);
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 12 });
    return audio;
  };
  it("keeps controls disabled until the audio is ready", () => {
    const audio = setup();
    expect(screen.getByRole("button", { name: "Play Test clip" })).toBeDisabled();
    fireEvent.loadedMetadata(audio);
    expect(screen.getByRole("button", { name: "Play Test clip" })).toBeEnabled();
    expect(screen.getByText("0:00.00 / 0:12.00")).toBeInTheDocument();
  });
  it("plays and pauses with the Space key, mutes with M and changes speed", async () => {
    const audio = setup(); fireEvent.loadedMetadata(audio);
    const group = screen.getByRole("group", { name: "Test clip" });
    fireEvent.keyDown(group, { key: " " });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause Test clip" })).toBeInTheDocument());
    fireEvent.keyDown(group, { key: " " });
    await waitFor(() => expect(screen.getByRole("button", { name: "Play Test clip" })).toBeInTheDocument());
    fireEvent.keyDown(group, { key: "m" });
    expect(audio.muted).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText("Playback speed"), "1.5");
    expect(audio.playbackRate).toBe(1.5);
  });
  it("seeks with the arrow keys, clamped to the duration", () => {
    const audio = setup(); fireEvent.loadedMetadata(audio);
    fireEvent.keyDown(screen.getByRole("group", { name: "Test clip" }), { key: "ArrowRight" });
    expect(audio.currentTime).toBe(5);
    fireEvent.keyDown(screen.getByRole("group", { name: "Test clip" }), { key: "ArrowLeft", shiftKey: true });
    expect(audio.currentTime).toBe(4);
  });
  it("reports a decode failure instead of silently doing nothing", () => {
    const audio = setup(); fireEvent.error(audio);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded or decoded/);
    expect(screen.getByRole("button", { name: "Play Test clip" })).toBeDisabled();
  });
});

describe("AudioUploader", () => {
  const pick = (file: File) => fireEvent.change(screen.getByLabelText("Choose audio file"), { target: { files: [file] } });
  it("passes a successful upload to the caller with the file name", async () => {
    vi.spyOn(api, "uploadWithProgress").mockResolvedValue({ metadata: { audio_id: "abc" } });
    const onUploaded = vi.fn(); render(<AudioUploader onUploaded={onUploaded} />);
    pick(new File(["x"], "clip.wav", { type: "audio/wav" }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(onUploaded.mock.calls[0][0]).toMatchObject({ metadata: { audio_id: "abc" }, file: { name: "clip.wav" } });
  });
  it("shows the server's rejection and does not report success", async () => {
    vi.spyOn(api, "uploadWithProgress").mockRejectedValue(new Error("unsupported or corrupt audio"));
    const onUploaded = vi.fn(); render(<AudioUploader onUploaded={onUploaded} />);
    pick(new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unsupported or corrupt audio");
    expect(onUploaded).not.toHaveBeenCalled();
  });
  it("shows upload progress while the request is running", async () => {
    let resolve!: (v: any) => void;
    vi.spyOn(api, "uploadWithProgress").mockImplementation((_f, onP) => new Promise((r) => { onP(40); resolve = r; }));
    render(<AudioUploader onUploaded={() => {}} />);
    pick(new File(["x"], "clip.wav"));
    expect(await screen.findByRole("status")).toHaveTextContent(/Uploading clip.wav/);
    expect(screen.getByText("40%")).toBeInTheDocument();
    resolve({ metadata: {} });
  });
});

describe("FilterResponseChart", () => {
  const f = [0, 100, 200, 300, 400, 500], mag = [0, -1, -10, -30, -50, -80];
  it("draws pass/transition/stop regions and cutoff markers from the response, plus a phase chart for causal filters", () => {
    render(<FilterResponseChart fs={1000} cutoffs={[200]} response={{ freqs_hz: f, magnitude_db: mag, phase_deg: [0, -20, -90, -170, -200, -220], effective: "|H| (single pass)" }} />);
    const layout = JSON.parse(screen.getByTestId("layout-Filter frequency response").textContent!);
    expect(layout.shapes.filter((s: any) => s.type === "rect")).toHaveLength(3);
    expect(layout.shapes.some((s: any) => s.type === "line" && s.x0 === 200)).toBe(true);
    expect(screen.getByText(/passband 0–200 Hz; transition band 200–400 Hz; stopband 400–500 Hz/)).toBeInTheDocument();
    expect(document.querySelector("[data-title='Filter phase response']")).not.toBeNull();
  });
  it("shows no phase chart for zero-phase filtering and says why", () => {
    render(<FilterResponseChart fs={1000} cutoffs={[200]} response={{ freqs_hz: f, magnitude_db: mag, phase_deg: [0, 0, 0, 0, 0, 0], effective: "|H|^2 (forward-backward)", phase_note: "Zero-phase (forward-backward) filtering has exactly zero phase response." }} />);
    expect(document.querySelector("[data-title='Filter phase response']")).toBeNull();
    expect(screen.getByText(/exactly zero phase response/)).toBeInTheDocument();
  });
});

describe("API client", () => {
  it("latest() aborts the previous request so a stale response cannot win", () => {
    const next = api.latest(); const s1 = next(), s2 = next();
    expect(s1.aborted).toBe(true); expect(s2.aborted).toBe(false);
  });
  it("turns an aborted fetch into AbortedError and keeps the in-flight counter balanced", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))));
    const before = api.getInflight();
    await expect(api.postJson("/x", {})).rejects.toSatisfy((e) => api.isAborted(e));
    expect(api.getInflight()).toBe(before);
    vi.unstubAllGlobals();
  });
  it("reports an unreachable backend plainly and a readable validation error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    await expect(api.postJson("/x", {})).rejects.toThrow(/Cannot reach the backend/);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: [{ loc: ["body", "order"], msg: "must be >= 1" }] }), { status: 422 }))));
    await expect(api.postJson("/x", {})).rejects.toThrow(/order/);
    vi.unstubAllGlobals();
  });
});

describe("workflow gating", () => {
  it("redirects a deep link to the upload step when no file has been analysed", async () => {
    render(<MemoryRouter initialEntries={["/clearvoice/filter"]}><SessionProvider><Routes>
      <Route path="/clearvoice/filter" element={<StepGuard module="clearvoice" step="filter"><p>FILTER STEP</p></StepGuard>} />
      <Route path="/clearvoice/upload" element={<p>UPLOAD STEP</p>} />
    </Routes></SessionProvider></MemoryRouter>);
    expect(await screen.findByText("UPLOAD STEP")).toBeInTheDocument();
    expect(screen.queryByText("FILTER STEP")).toBeNull();
  });
});
