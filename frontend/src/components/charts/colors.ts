export function chartColors() {
  const c = getComputedStyle(document.documentElement), g = (n: string, d: string) => c.getPropertyValue(n).trim() || d;
  return { c1: g("--chart-1", "#22d3ee"), c2: g("--chart-2", "#8b7cf6"), c3: g("--chart-3", "#4ade80"), event: g("--chart-event", "#ffb020") };
}
