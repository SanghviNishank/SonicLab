/** Measurements taken from the user's actual session. Nothing here is a default or an example value: a missing fact stays undefined. */
export interface Facts {
  source: "clearvoice" | "roadsonic" | null;
  fileName?: string; fs?: number; channels?: number; durationS?: number; samples?: number; peak?: number; rms?: number;
  peaks: { f: number; a: number }[]; window?: string; binSpacingHz?: number;
  filter?: { kind: "filter" | "voice"; type?: string; cutoff?: number[]; order?: number; method?: string; preset?: string; nrEnabled?: boolean; nr?: any; label?: string };
  rmsBefore?: number; rmsAfter?: number; hasSpectra: boolean; hasSpectrogram: boolean; events?: number;
}
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const maxOf = (a: any[], k: string) => { const v = a.map((c) => c?.[k]).filter(fin); return v.length ? Math.max(...v) : undefined; };

export function buildFacts(cv: any, rs: any): Facts {
  const up = cv?.upload ?? rs?.upload, source: Facts["source"] = cv?.upload ? "clearvoice" : rs?.upload ? "roadsonic" : null;
  if (!up) return { source: null, peaks: [], hasSpectra: false, hasSpectrogram: false };
  const m = up.metadata ?? {}, per = up.statistics?.per_channel ?? [];
  const f: Facts = { source, fileName: up.file?.name, fs: fin(m.sample_rate_hz) ? m.sample_rate_hz : undefined, channels: fin(m.channels) ? m.channels : undefined,
    durationS: fin(m.duration_s) ? m.duration_s : undefined, samples: fin(m.samples_per_channel) ? m.samples_per_channel : undefined, peak: maxOf(per, "peak_abs"), rms: maxOf(per, "rms"),
    peaks: [], hasSpectra: false, hasSpectrogram: false };
  const sp = source === "clearvoice" ? cv.analysis?.spectrum : rs?.res?.spectrum;
  if (sp) { f.peaks = (sp.peaks ?? []).map((p: any) => ({ f: p.frequency_hz, a: p.amplitude })); f.window = sp.window; f.binSpacingHz = sp.bin_spacing_hz; f.hasSpectra = true; }
  f.hasSpectrogram = source === "clearvoice" ? !!cv.analysis?.spectrogram : !!rs?.res?.spectrogram;
  if (source === "roadsonic" && rs?.detected && Array.isArray(rs?.res?.events)) f.events = rs.res.events.length;
  const r = cv?.filter?.result;
  if (source === "clearvoice" && r) {
    const c = r.config ?? {}, nr = c.stages?.noise_reduction;
    f.filter = c.pipeline === "voice" ? { kind: "voice", preset: c.preset, nrEnabled: !!nr?.enabled, nr, label: cv.filter.label }
      : { kind: "filter", type: c.filter_type, cutoff: c.cutoff_hz, order: c.order, method: c.method, label: cv.filter.label };
    const pc = r.metrics?.per_channel;
    if (Array.isArray(pc) && pc.length) { f.rmsBefore = maxOf(pc, "rms_before"); f.rmsAfter = maxOf(pc, "rms_after"); }
    f.hasSpectra = f.hasSpectra || !!r.spectrum_original;
  }
  return f;
}

export const hz = (v: number) => `${Math.round(v * 10) / 10} Hz`;
export const num = (v: number) => v.toLocaleString("en-US");
export const level = (v: number) => (Math.round(v * 10000) / 10000).toString();

export function filterSentence(f: NonNullable<Facts["filter"]>): string {
  if (f.kind === "voice") return `You ran the voice-enhancement pipeline (preset "${f.preset}").${f.nrEnabled ? " It includes a noise-reduction stage." : " That preset does not include noise reduction."}`;
  const c = f.cutoff ?? [], cut = c.map(hz).join(" and "), phase = f.method === "zero_phase" ? "forward-backward (zero-phase)" : "single-pass (causal)";
  const body: Record<string, string> = {
    lowpass: `You selected a low-pass filter with a cutoff of ${cut}. It reduces frequencies above that cutoff. This can reduce hiss, but an aggressive cutoff also dulls the voice.`,
    highpass: `You selected a high-pass filter with a cutoff of ${cut}. It reduces frequencies below your chosen cutoff. This can help reduce low-frequency rumble, but an aggressive cutoff may also weaken the voice.`,
    bandpass: `You selected a band-pass filter keeping ${cut.replace(" and ", " to ")}. Frequencies outside that band are reduced.`,
    bandstop: `You selected a band-stop filter reducing ${cut.replace(" and ", " to ")}. Everything outside that band is kept.`,
  };
  return `${body[f.type ?? ""] ?? "A filter was applied."} Order ${f.order}, ${phase}.`;
}
