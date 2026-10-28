import { useCallback, useRef, useState } from "react";
import { isAborted, latest, postJson } from "../../api";
import { useSession } from "../../context/Session";

export interface AnalysisParams { channel: number; window: "hann" | "rect"; frame_length: number; hop_length: number | null }
export const DEFAULT_PARAMS: AnalysisParams = { channel: 0, window: "hann", frame_length: 1024, hop_length: null };

/** Runs /clearvoice/{id}/analyze and stores the result (with its parameters) in the session. */
export function useAnalysis() {
  const { cv, patchCv } = useSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const id = cv.upload?.metadata.audio_id, next = useRef(latest()).current;
  const run = useCallback(async (params: AnalysisParams) => {
    if (!id) return;
    setBusy(true); setError("");
    try {
      const res = await postJson(`/api/v1/clearvoice/${id}/analyze`, { window: params.window, channel: params.channel, frame_length: params.frame_length, hop_length: params.hop_length, compare_windows: true }, next());
      patchCv({ analysis: { ...res, params } });
    } catch (e: any) { if (!isAborted(e)) { setError(e.message); setBusy(false); } return; } setBusy(false);
  }, [id, patchCv]);
  return { busy, error, run, analysis: cv.analysis, params: (cv.analysis?.params ?? DEFAULT_PARAMS) as AnalysisParams };
}
