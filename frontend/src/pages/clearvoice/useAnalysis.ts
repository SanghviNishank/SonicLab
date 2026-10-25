import { useCallback, useState } from "react";
import { postJson } from "../../api";
import { useSession } from "../../context/Session";

export interface AnalysisParams { channel: number; window: "hann" | "rect"; frame_length: number; hop_length: number | null }
export const DEFAULT_PARAMS: AnalysisParams = { channel: 0, window: "hann", frame_length: 1024, hop_length: null };

/** Runs /clearvoice/{id}/analyze and stores the result (with its parameters) in the session. */
export function useAnalysis() {
  const { cv, patchCv } = useSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const id = cv.upload?.metadata.audio_id;
  const run = useCallback(async (params: AnalysisParams) => {
    if (!id) return;
    setBusy(true); setError("");
    try {
      const res = await postJson(`/api/v1/clearvoice/${id}/analyze`, { window: params.window, channel: params.channel, frame_length: params.frame_length, hop_length: params.hop_length, compare_windows: true });
      patchCv({ analysis: { ...res, params } });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }, [id, patchCv]);
  return { busy, error, run, analysis: cv.analysis, params: (cv.analysis?.params ?? DEFAULT_PARAMS) as AnalysisParams };
}
