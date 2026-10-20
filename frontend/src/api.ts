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
