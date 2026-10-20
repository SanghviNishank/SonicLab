import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
const P = createPlotlyComponent(Plotly);

export default function Plot({ data, layout, title }: { data: any[]; layout?: any; title: string }) {
  const dark = document.documentElement.dataset.theme !== "light";
  const fg = dark ? "#e6e8ee" : "#1b1e27";
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      <P data={data} useResizeHandler style={{ width: "100%", height: 320 }}
        config={{ responsive: true, displaylogo: false }}
        layout={{ autosize: true, margin: { l: 55, r: 15, t: 10, b: 45 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: fg }, xaxis: { gridcolor: "#8884" }, yaxis: { gridcolor: "#8884" }, legend: { orientation: "h" }, ...layout }} />
    </section>
  );
}
