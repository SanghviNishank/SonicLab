import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, del } from "../api";
import { parse, serialize } from "../logic/session.ts";
import type { ModuleId, Snapshot } from "../logic/workflow.ts";

export interface CVSession { upload: any | null; analysis: any | null; filter: any | null; loaded: Record<string, boolean> }
export interface RSSession { upload: any | null; res: any | null; detected: boolean; settings: any | null; lastRun: string; sel: number | null; reviewed: Record<number, boolean>; loaded: Record<string, boolean> }
const emptyCV = (): CVSession => ({ upload: null, analysis: null, filter: null, loaded: {} });
const emptyRS = (): RSSession => ({ upload: null, res: null, detected: false, settings: null, lastRun: "", sel: null, reviewed: {}, loaded: {} });
const KEY = (m: ModuleId) => `sonicsense.${m}`;

interface Ctx {
  cv: CVSession; rs: RSSession; restoring: boolean; notice: string;
  patchCv: (p: Partial<CVSession>) => void; patchRs: (p: Partial<RSSession>) => void;
  markLoaded: (m: ModuleId, step: string) => void; clearNotice: () => void;
  discard: (m: ModuleId) => Promise<void>;
}
const SessionContext = createContext<Ctx | null>(null);
export function useSession(): Ctx { const c = useContext(SessionContext); if (!c) throw new Error("SessionProvider missing"); return c; }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [cv, setCv] = useState<CVSession>(emptyCV);
  const [rs, setRs] = useState<RSSession>(emptyRS);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState("");
  const cvRef = useRef(cv), rsRef = useRef(rs); cvRef.current = cv; rsRef.current = rs;

  // Restore after a reload: only identifiers/settings are stored in sessionStorage; the audio itself stays on the server (1 h TTL).
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const m of ["clearvoice", "roadsonic"] as ModuleId[]) {
        const saved = parse(sessionStorage.getItem(KEY(m)), m);
        if (!saved) { sessionStorage.removeItem(KEY(m)); continue; }
        try {
          const up = await call(`/api/v1/audio/${saved.audioId}/summary`);
          if (!alive) return;
          const upload = { ...up, metadata: { ...up.metadata, audio_id: saved.audioId }, file: { name: saved.filename } };
          if (m === "clearvoice") setCv((s) => ({ ...s, upload })); else setRs((s) => ({ ...s, upload, settings: saved.settings ?? null }));
        } catch {
          sessionStorage.removeItem(KEY(m));
          if (alive) setNotice("Your earlier session expired on the server (recordings are kept for about an hour). Please upload the file again.");
        }
      }
      if (alive) setRestoring(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (restoring) return;
    if (cv.upload) sessionStorage.setItem(KEY("clearvoice"), serialize({ module: "clearvoice", audioId: cv.upload.metadata.audio_id, filename: cv.upload.file?.name ?? "" }));
    else sessionStorage.removeItem(KEY("clearvoice"));
  }, [cv.upload, restoring]);
  useEffect(() => {
    if (restoring) return;
    if (rs.upload) sessionStorage.setItem(KEY("roadsonic"), serialize({ module: "roadsonic", audioId: rs.upload.metadata.audio_id, filename: rs.upload.file?.name ?? "", settings: rs.settings }));
    else sessionStorage.removeItem(KEY("roadsonic"));
  }, [rs.upload, rs.settings, restoring]);

  const patchCv = useCallback((p: Partial<CVSession>) => setCv((s) => ({ ...s, ...p })), []);
  const patchRs = useCallback((p: Partial<RSSession>) => setRs((s) => ({ ...s, ...p })), []);
  const markLoaded = useCallback((m: ModuleId, step: string) => {
    const set = m === "clearvoice" ? setCv : setRs;
    (set as any)((s: any) => (s.loaded[step] ? s : { ...s, loaded: { ...s.loaded, [step]: true } }));
  }, []);
  const discard = useCallback(async (m: ModuleId) => {
    const id = (m === "clearvoice" ? cvRef.current.upload : rsRef.current.upload)?.metadata.audio_id;
    if (id) { try { await del(`/api/v1/audio/${id}`); } catch { /* already expired: nothing to clean up */ } }
    if (m === "clearvoice") setCv(emptyCV()); else setRs(emptyRS());
  }, []);
  const value = useMemo<Ctx>(() => ({ cv, rs, restoring, notice, patchCv, patchRs, markLoaded, clearNotice: () => setNotice(""), discard }), [cv, rs, restoring, notice, patchCv, patchRs, markLoaded, discard]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function snapshotFor(m: ModuleId, cv: CVSession, rs: RSSession): Snapshot {
  return m === "clearvoice"
    ? { hasUpload: !!cv.upload, hasSpectrum: !!cv.analysis?.spectrum, hasSpectrogram: !!cv.analysis?.spectrogram, hasFilterResult: !!cv.filter?.result, loaded: cv.loaded }
    : { hasUpload: !!rs.upload, hasAnalysis: !!rs.res, hasDetection: rs.detected, loaded: rs.loaded };
}
export function useSnapshot(m: ModuleId): Snapshot { const { cv, rs } = useSession(); return snapshotFor(m, cv, rs); }

/** Marks a step as completed-by-viewing only once it actually rendered real data. */
export function useMarkLoaded(m: ModuleId, step: string, ready: boolean) {
  const { markLoaded } = useSession();
  useEffect(() => { if (ready) markLoaded(m, step); }, [ready, m, step, markLoaded]);
}
