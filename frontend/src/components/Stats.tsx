export default function Stats({ res }: { res: any }) {
  const m = res.metadata, s = res.statistics;
  const f = (v: number | null, d = 4) => (v == null ? "—" : v.toFixed(d));
  return (
    <section className="card">
      <h3>2 · Metadata &amp; statistics</h3>
      <div className="grid">
        <div><b>{(m.sample_rate_hz / 1000).toFixed(3)} kHz</b><span>sample rate</span></div>
        <div><b>{m.channels}</b><span>channels</span></div>
        <div><b>{m.duration_s.toFixed(3)} s</b><span>duration</span></div>
        <div><b>{m.samples_per_channel}</b><span>samples / channel</span></div>
        <div><b>{m.sample_format}</b><span>file format</span></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Ch</th><th>min</th><th>max</th><th>mean</th><th>RMS</th><th>variance*</th><th>peak</th></tr></thead>
        <tbody>{s.per_channel.map((c: any, i: number) => <tr key={i}><td>{i}</td><td>{f(c.min)}</td><td>{f(c.max)}</td><td>{f(c.mean, 6)}</td>
          <td>{f(c.rms)}</td><td>{f(c.variance, 6)}</td><td>{f(c.peak_abs)}</td></tr>)}</tbody></table></div>
      <p className="muted">*population variance (ddof = 0). Amplitudes are relative to full scale = 1.0.</p>
      {s.warnings.map((w: string, i: number) => <p key={i} className="warn">⚠ {w}</p>)}
    </section>
  );
}
