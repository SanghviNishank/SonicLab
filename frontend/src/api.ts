import { formatDetail } from "./logic/format.ts";
export { formatDetail };
const BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
export const url = (p: string) => BASE + p;


/** Thrown when a request was cancelled on purpose (navigation, a newer request). Callers ignore it: it is not an error to show. */
export class AbortedError extends Error { constructor() { super("Request cancelled."); this.name = "AbortedError"; } }
export const isAborted = (e: unknown): boolean => e instanceof AbortedError || (e as any)?.name === "AbortError";

/** Live count of requests in flight, for the global processing indicator (real state, not a timer). */
let inflight = 0; const subs = new Set<() => void>();
const bump = (d: number) => { inflight += d; subs.forEach((f) => f()); };
export const subscribeInflight = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getInflight = () => inflight;

/** "Latest request wins": each call returns a fresh AbortSignal and aborts the previous one, so a slow stale response can never
 *  overwrite a newer result. Use one `latest()` per independent request stream (e.g. one per chart or form). */
export function latest(): () => AbortSignal {
  let ctl: AbortController | null = null;
  return () => { ctl?.abort(); ctl = new AbortController(); return ctl.signal; };
}

export async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  bump(1);
  try {
    try { r = await fetch(BASE + path, init); }
    catch (e) {
      if (isAborted(e)) throw new AbortedError();
      throw new Error("Cannot reach the backend. Is it running on " + BASE + "?");
    }
    if (!r.ok) {
      let msg = r.statusText;
      try { const j = await r.json(); msg = formatDetail(j.detail, r.statusText); } catch {}
      throw new Error(msg);
    }
    try { return await r.json(); } catch (e) { if (isAborted(e)) throw new AbortedError(); throw new Error("The server sent a response that is not valid JSON."); }
  } finally { bump(-1); }
}
export const postJson = <T = any>(path: string, body: unknown, signal?: AbortSignal) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
export async function upload(file: File) {
  const fd = new FormData(); fd.append("file", file);
  return call("/api/v1/audio/upload", { method: "POST", body: fd });
}

export async function del(path: string): Promise<any> { return call(path, { method: "DELETE" }); }

/** Multipart upload with REAL progress (XMLHttpRequest exposes upload progress; fetch does not). */
export function uploadWithProgress(file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    bump(1);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url("/api/v1/audio/upload"));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((100 * e.loaded) / e.total)); };
    xhr.onloadend = () => bump(-1);
    xhr.onload = () => {
      let body: any = null; try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body) { onProgress(100); resolve(body); }
      else reject(new Error(body?.detail ? formatDetail(body.detail) : `Upload failed (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Cannot reach the backend. Is it running on " + url("") + "?"));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    const fd = new FormData(); fd.append("file", file); xhr.send(fd);
  });
}
