/** What is persisted in sessionStorage: identifiers and settings only - never audio. The server keeps the audio (TTL). */
export interface PersistedSession { v: 1; module: "clearvoice" | "roadsonic"; audioId: string; filename: string; savedAt: number; settings?: unknown }
export const MAX_AGE_MS = 55 * 60 * 1000;                                   // the backend TTL is 1 h; stay safely below it

export function serialize(p: Omit<PersistedSession, "v" | "savedAt">, now = Date.now()): string {
  return JSON.stringify({ v: 1, savedAt: now, ...p });
}
export function parse(raw: string | null, module: string, now = Date.now()): PersistedSession | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || o.module !== module || typeof o.audioId !== "string" || !/^[0-9a-f]{32}$/.test(o.audioId)) return null;
    if (typeof o.savedAt !== "number" || now - o.savedAt > MAX_AGE_MS || o.savedAt > now + 60_000) return null;
    return { v: 1, module: o.module, audioId: o.audioId, filename: String(o.filename ?? ""), savedAt: o.savedAt, settings: o.settings };
  } catch { return null; }
}
