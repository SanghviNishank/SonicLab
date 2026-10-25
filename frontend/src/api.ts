const BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
export const url = (p: string) => BASE + p;

export async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(BASE + path, init); }
  catch { throw new Error("Cannot reach the backend. Is it running on " + BASE + "?"); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}
export const postJson = <T = any>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export async function upload(file: File) {
  const fd = new FormData(); fd.append("file", file);
  return call("/api/v1/audio/upload", { method: "POST", body: fd });
}

export async function del(path: string): Promise<any> { return call(path, { method: "DELETE" }); }

/** Multipart upload with REAL progress (XMLHttpRequest exposes upload progress; fetch does not). */
export function uploadWithProgress(file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url("/api/v1/audio/upload"));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((100 * e.loaded) / e.total)); };
    xhr.onload = () => {
      let body: any = null; try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body) { onProgress(100); resolve(body); }
      else reject(new Error(body?.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `Upload failed (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Cannot reach the backend. Is it running on " + url("") + "?"));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    const fd = new FormData(); fd.append("file", file); xhr.send(fd);
  });
}
