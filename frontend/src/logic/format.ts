export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "–";
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, "0")}`;
}
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
export function formatHz(f: number): string {
  if (!Number.isFinite(f)) return "–";
  return f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 3)} kHz` : `${f.toFixed(f % 1 === 0 ? 0 : 1)} Hz`;
}

/** FastAPI returns `detail` as a string (our own errors) or a list of {loc, msg} (request validation). Make both readable. */
export function formatDetail(detail: unknown, fallback = "Request failed."): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d: any) => d && typeof d.msg === "string"
      ? `${(Array.isArray(d.loc) ? d.loc.filter((l: any) => l !== "body").join(".") : "") || "request"}: ${d.msg}` : "").filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return detail == null ? fallback : JSON.stringify(detail);
}
