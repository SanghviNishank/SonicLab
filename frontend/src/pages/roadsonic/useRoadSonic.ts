import { useCallback, useEffect, useRef, useState } from "react";
import { call, isAborted, latest, postJson } from "../../api";
import { useSession } from "../../context/Session";
import { buildSettings, toRequest } from "../../logic/roadsonicSettings.ts";

let cachedDefaults: any = null;

/** Loads the server-side defaults once, seeds the session settings, and exposes run(): the single path to POST /roadsonic/{id}/detect. */
export function useRoadSonic() {
  const { rs, patchRs } = useSession();
  const [defaults, setDefaults] = useState<any>(cachedDefaults), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const reqId = useRef(0), nextSignal = useRef(latest()).current;
  useEffect(() => {
    if (defaults) return;
    call("/api/v1/roadsonic/defaults").then((d) => { cachedDefaults = d; setDefaults(d); }).catch((e) => setError("Could not load detector defaults: " + e.message));
  }, [defaults]);
  useEffect(() => { if (defaults && !rs.settings) patchRs({ settings: buildSettings(defaults) }); }, [defaults, rs.settings, patchRs]);
  const id = rs.upload?.metadata.audio_id;
  const dirty = !!rs.res && !!rs.settings && JSON.stringify(toRequest(rs.settings)) !== rs.lastRun;

  /** detected=false: analysis only (events are kept out of the earlier steps); detected=true: the explicit detection step. */
  const run = useCallback(async (settings: any, detected: boolean): Promise<boolean> => {
    if (!id || !settings) return false;
    const mine = ++reqId.current, body = toRequest(settings);              // results of superseded requests are ignored
    setBusy(true); setError("");
    try {
      const res = await postJson(`/api/v1/roadsonic/${id}/detect`, body, nextSignal());
      if (mine !== reqId.current) return false;
      patchRs({ res, detected, lastRun: JSON.stringify(body), sel: null, reviewed: {}, settings });
      return true;
    } catch (e: any) { if (mine === reqId.current && !isAborted(e)) setError(e.message); return false; }
    finally { if (mine === reqId.current) setBusy(false); }
  }, [id, patchRs]);
  return { defaults, busy, error, run, dirty, settings: rs.settings, setSettings: (s: any) => patchRs({ settings: s }), resetSettings: () => defaults && patchRs({ settings: buildSettings(defaults) }) };
}
