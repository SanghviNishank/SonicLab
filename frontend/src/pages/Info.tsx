import { Link } from "react-router-dom";

export function Info({ kind }: { kind: "how" | "docs" }) {
  if (kind === "how") return (
    <div className="page stack"><h1>How It Works</h1>
      <div className="grid2"><section className="card"><h3>ClearVoice workflow</h3><ol><li>Upload and validate</li><li>Overview of metadata and statistics</li><li>Time-domain analysis</li><li>Frequency-domain analysis (FFT)</li><li>Spectrogram (STFT)</li><li>Filter or voice pipeline</li><li>Original vs processed comparison</li><li>Results and export</li></ol><Link className="btn" to="/clearvoice/upload">Start ClearVoice</Link></section>
        <section className="card" data-module="roadsonic"><h3>RoadSonic workflow</h3><ol><li>Upload traffic audio</li><li>Overview</li><li>Optional preprocessing</li><li>Feature analysis</li><li>Candidate siren detection</li><li>Event timeline</li><li>Event review</li><li>Summary and evaluation</li></ol><Link className="btn" to="/roadsonic/upload">Start RoadSonic</Link></section></div>
      <section className="card"><h3>Principles</h3><ul className="muted"><li>The original recording is never modified; every result is computed from it again.</li><li>A step is "completed" only when its real data exists, not when you click Next.</li><li>Filtering is not denoising; spectral noise reduction handles steady noise only.</li><li>RoadSonic reports <i>candidate</i> events from fixed rules; it is not machine learning and not a safety system.</li></ul></section></div>);
  return (
    <div className="page stack"><h1>Documentation</h1>
      <section className="card"><p className="muted">Project documents live in the repository's <code>docs/</code> folder. Run the backend and open <code>http://127.0.0.1:8000/docs</code> for the interactive API reference.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Document</th><th>Contents</th></tr></thead><tbody>
          <tr><td>README.md</td><td>Windows setup, run and test commands</td></tr><tr><td>docs/clearvoice.md</td><td>Mathematics, presets, limits, viva questions</td></tr><tr><td>docs/roadsonic.md</td><td>Detector design, benchmark, limits, viva questions</td></tr>
          <tr><td>docs/sonicsense_frontend.md</td><td>Routes, session model, design tokens, test report</td></tr><tr><td>docs/implementation_status.md</td><td>What is verified, unverified and missing</td></tr></tbody></table></div></section></div>);
}
