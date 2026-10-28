export type PlayerAction = { type: "toggle" } | { type: "seek"; delta: number } | { type: "mute" } | { type: "volume"; delta: number } | null;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Keyboard shortcuts of the audio players (applied only while focus is inside the player). */
export function actionForKey(key: string, shift = false): PlayerAction {
  switch (key) {
    case " ": case "k": case "K": return { type: "toggle" };
    case "ArrowLeft": return { type: "seek", delta: shift ? -1 : -5 };
    case "ArrowRight": return { type: "seek", delta: shift ? 1 : 5 };
    case "m": case "M": return { type: "mute" };
    case "ArrowUp": return { type: "volume", delta: 0.1 };
    case "ArrowDown": return { type: "volume", delta: -0.1 };
    default: return null;
  }
}
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
