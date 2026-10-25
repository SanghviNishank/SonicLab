import { chartColors } from "../../components/charts/colors";
/** Event rectangles (dotted = candidate, solid + heavier = selected) plus numbered labels, so events are not distinguished by colour alone. */
export function eventOverlays(events: any[], sel: number | null, cursor?: number | null) {
  const c = chartColors();
  const shapes: any[] = events.map((e, i) => ({ type: "rect", xref: "x", yref: "paper", x0: e.start_s, x1: e.end_s, y0: 0, y1: 1,
    fillcolor: i === sel ? "rgba(255,176,32,0.40)" : "rgba(255,176,32,0.16)", line: { width: i === sel ? 2.5 : 1.2, color: c.event, dash: i === sel ? "solid" : "dot" } }));
  if (cursor != null) shapes.push({ type: "line", xref: "x", yref: "paper", x0: cursor, x1: cursor, y0: 0, y1: 1, line: { color: c.c1, width: 2 } });
  const annotations = events.map((e, i) => ({ x: (e.start_s + e.end_s) / 2, xref: "x", y: 1, yref: "paper", text: `#${i + 1}`, showarrow: false, yanchor: "bottom", font: { color: c.event } }));
  return { shapes, annotations };
}
