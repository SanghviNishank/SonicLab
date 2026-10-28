import { useEffect, useState, type ComponentType } from "react";

/** Plotly is ~1 MB even in the cartesian-only build, so it is fetched only when the first chart is shown (not on the landing page). */
let plotPromise: Promise<ComponentType<any>> | null = null;
function loadPlot() {
  plotPromise ??= Promise.all([import("plotly.js-cartesian-dist-min"), import("react-plotly.js/factory")])
    .then(([plotly, factory]) => (factory.default as any)((plotly as any).default ?? plotly));
  return plotPromise;
}
function usePlotComponent() {
  const [C, setC] = useState<ComponentType<any> | null>(null), [err, setErr] = useState(false);
  useEffect(() => { let live = true; loadPlot().then((c) => live && setC(() => c)).catch(() => { plotPromise = null; live && setErr(true); }); return () => { live = false; }; }, []);
  return { C, err };
}

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

export default function Plot({ data, layout, title, onClick, onRange, height = 320, note, summary }: { data: any[]; layout?: any; title: string; onClick?: (x: number) => void; onRange?: (r: [number, number] | null) => void; height?: number; note?: string; summary?: string }) {
  const { C: P, err } = usePlotComponent();
  useDark();                                            // re-render when the theme attribute changes
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue("--fg").trim() || "#e6e8ee";
  const grid = css.getPropertyValue("--chart-grid").trim() || "#8884";
  return (
    <section className="card chart" aria-label={title}>
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      {summary && <p className="sr">{summary}</p>}
      {err ? <p className="error" role="alert">The chart library could not be loaded. Check your connection and reload the page.</p>
        : !P ? <div className="chart-loading muted" style={{ height }} role="status">Loading chart…</div> :
      <P data={data} useResizeHandler style={{ width: "100%", height }}
        onClick={onClick ? (ev: any) => { const x = ev?.points?.[0]?.x; if (typeof x === "number") onClick(x); } : undefined}
        config={{ responsive: true, displaylogo: false }}
        onRelayout={onRange ? (ev: any) => { if (ev["xaxis.range[0]"] !== undefined) onRange([Number(ev["xaxis.range[0]"]), Number(ev["xaxis.range[1]"])]); else if (ev["xaxis.autorange"]) onRange(null); } : undefined}
        layout={{ autosize: true, margin: { l: 55, r: 15, t: 10, b: 45 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: fg, family: "Inter, Segoe UI, system-ui, sans-serif", size: 12 }, legend: { orientation: "h" }, ...layout,
          xaxis: { gridcolor: grid, ...(layout?.xaxis ?? {}) }, yaxis: { gridcolor: grid, ...(layout?.yaxis ?? {}) } }} />}
    </section>
  );
}
