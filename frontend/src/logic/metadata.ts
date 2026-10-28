import { formatBytes } from "./format.ts";

export interface MetaRow { label: string; value: string; known: boolean; hint?: string }
const NOT_CALC = "not calculated";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Rows of the file-information panel, built only from what the backend returned. Missing or non-finite values are shown as
 *  "not calculated" instead of 0 or a guess. */
export function metadataRows(upload: any, fileName?: string): MetaRow[] {
  const m = upload?.metadata ?? {}, per: any[] = upload?.statistics?.per_channel ?? [];
  const max = (k: string) => { const v = per.map((c) => c?.[k]).filter(finite); return v.length ? Math.max(...v) : undefined; };
  const row = (label: string, v: string | undefined, hint?: string): MetaRow => ({ label, value: v ?? NOT_CALC, known: v !== undefined, hint });
  const peak = max("peak_abs"), rms = max("rms");
  return [
    row("File", fileName || upload?.file?.name || undefined),
    row("Format", m.source_format ? String(m.source_format).toUpperCase() : undefined, "Container the file was uploaded as."),
    row("Sample format", m.sample_format ? `${m.sample_format} → decoded to ${m.decoded_dtype ?? "float"}` : undefined),
    row("File size", finite(m.file_size_bytes) ? formatBytes(m.file_size_bytes) : undefined),
    row("Sample rate", finite(m.sample_rate_hz) ? `${m.sample_rate_hz} Hz` : undefined, "fs: samples per second. Ts = 1/fs. The Nyquist frequency is fs/2."),
    row("Duration", finite(m.duration_s) ? `${m.duration_s.toFixed(3)} s` : undefined),
    row("Samples / channel", finite(m.samples_per_channel) ? m.samples_per_channel.toLocaleString("en-US") : undefined, "N: x[n] = x(nTs) for n = 0 … N−1."),
    row("Channels", finite(m.channels) ? String(m.channels) : undefined),
    row("Peak amplitude", peak !== undefined ? peak.toFixed(4) : undefined, "Largest absolute sample, full scale = 1.0 (loudest channel)."),
    row("RMS", rms !== undefined ? rms.toFixed(4) : undefined, "Root-mean-square level (loudest channel)."),
  ];
}
