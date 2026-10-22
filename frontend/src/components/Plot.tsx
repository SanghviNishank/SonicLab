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

export default function Plot({ data, layout, title, onClick, height = 320, note }: { data: any[]; layout?: any; title: string; onClick?: (x: number) => void; height?: number; note?: string }) {
  const dark = useDark();
  const fg = dark ? "#e6e8ee" : "#1b1e27";
  return (
    <section className="card chart" aria-label={title}>
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      <P data={data} useResizeHandler style={{ width: "100%", height }}
        onClick={onClick ? (ev: any) => { const x = ev?.points?.[0]?.x; if (typeof x === "number") onClick(x); } : undefined}
        config={{ responsive: true, displaylogo: false }}
        layout={{ autosize: true, margin: { l: 55, r: 15, t: 10, b: 45 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: fg }, legend: { orientation: "h" }, ...layout,
          xaxis: { gridcolor: "#8884", ...(layout?.xaxis ?? {}) }, yaxis: { gridcolor: "#8884", ...(layout?.yaxis ?? {}) } }} />
    </section>
  );
}
