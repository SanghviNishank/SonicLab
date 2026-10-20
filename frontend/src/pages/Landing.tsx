import { Link } from "react-router-dom";
export default function Landing() {
  return (
    <div className="stack">
      <h1>Audio signal processing, made inspectable</h1>
      <p className="muted">Two academic projects sharing one design system and one backend. All results are computed on the server from your actual recording.</p>
      <div className="cards">
        <article className="card"><h2>ClearVoice</h2>
          <p>Waveform, statistics, calibrated spectrum, spectrogram, Butterworth filtering, before/after comparison and WAV export.</p>
          <ul><li>Low-pass · high-pass · band-pass · notch</li><li>Causal or zero-phase filtering</li><li>Honest signal-change metrics</li></ul>
          <Link className="btn" to="/clearvoice">Open ClearVoice →</Link></article>
        <article className="card"><h2>RoadSonic</h2>
          <p>Interpretable rule-based detection of <em>candidate</em> emergency-siren intervals in noisy traffic audio, with evidence per event.</p>
          <ul><li>Frame features &amp; dominant-frequency track</li><li>Event timeline &amp; CSV/JSON export</li><li>Academic prototype — not a safety system</li></ul>
          <Link className="btn" to="/roadsonic">Open RoadSonic →</Link></article>
      </div>
    </div>
  );
}
