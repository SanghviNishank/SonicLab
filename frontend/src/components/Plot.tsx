import { useEffect, useState } from "react";
import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
const P = createPlotlyComponent(Plotly);

function useDark() {
  const get = () => document.documentElement.dataset.theme !== "light";
  const [dark, setDark] = useState(get);
  useEffect(() => {
    const o = new MutationObserver(() => setDark(get()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

export default function Plot({ data, layout, title, onClick, onRange, height = 320, note }: { data: any[]; layout?: any; title: string; onClick?: (x: number) => void; onRange?: (r: [number, number] | null) => void; height?: number; note?: string }) {
  useDark();                                            // re-render when the theme attribute changes
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue("--fg").trim() || "#e6e8ee";
  const grid = css.getPropertyValue("--chart-grid").trim() || "#8884";
  return (
    <section className="card chart" aria-label={title}>
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      <P data={data} useResizeHandler style={{ width: "100%", height }}
        onClick={onClick ? (ev: any) => { const x = ev?.points?.[0]?.x; if (typeof x === "number") onClick(x); } : undefined}
        config={{ responsive: true, displaylogo: false }}
        onRelayout={onRange ? (ev: any) => { if (ev["xaxis.range[0]"] !== undefined) onRange([Number(ev["xaxis.range[0]"]), Number(ev["xaxis.range[1]"])]); else if (ev["xaxis.autorange"]) onRange(null); } : undefined}
        layout={{ autosize: true, margin: { l: 55, r: 15, t: 10, b: 45 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: fg, family: "Inter, Segoe UI, system-ui, sans-serif", size: 12 }, legend: { orientation: "h" }, ...layout,
          xaxis: { gridcolor: grid, ...(layout?.xaxis ?? {}) }, yaxis: { gridcolor: grid, ...(layout?.yaxis ?? {}) } }} />
    </section>
  );
}
