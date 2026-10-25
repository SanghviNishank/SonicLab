import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, AudioWaveform, Siren } from "lucide-react";
import HeroVisual from "../components/hero/HeroVisual";
import FeaturePreview from "../components/hero/FeaturePreview";
import type { SculptureMode } from "../components/hero/SoundSculpture";

export default function HomePage() {
  const [mode, setMode] = useState<SculptureMode>("idle");
  return (
    <>
      <section className="hero" aria-label="SonicSense introduction">
        <HeroVisual mode={mode} />
        <div className="hero-copy">
          <div className="eyebrow">Audio intelligence platform</div>
          <h1>Every Sound Has a <em>Signal.</em></h1>
          <p className="lead">Analyze, transform, and understand audio with interactive signal processing and intelligent acoustic event detection.</p>
          <div className="actions" style={{ margin: "1.5rem 0 1rem" }}>
            <Link className="btn" to="/clearvoice/upload" onMouseEnter={() => setMode("clearvoice")} onFocus={() => setMode("clearvoice")}><AudioWaveform size={16} /> Explore ClearVoice</Link>
            <Link className="btn ghost" to="/roadsonic/upload" onMouseEnter={() => setMode("roadsonic")} onFocus={() => setMode("roadsonic")}><Siren size={16} /> Launch RoadSonic</Link></div>
          <Link to="/how-it-works" className="muted">See how the platform works <ArrowRight size={13} style={{ verticalAlign: "-2px" }} /></Link>
          <p className="muted" style={{ marginTop: "1.25rem", fontSize: ".78rem" }}>The 3D ribbon is a decorative visualization driven by mathematical sine terms, not by any audio.</p>
        </div>
      </section>

      <section className="section" aria-labelledby="products"><h2 id="products">Two workspaces, one design system</h2>
        <div className="grid2">
          <article className="card product" data-module="clearvoice"><h3>ClearVoice</h3><p>Interactive audio analysis, voice enhancement and digital filtering.</p>
            <ul><li>Waveform, calibrated FFT spectrum and spectrogram</li><li>Low-pass, high-pass, band-pass and band-stop Butterworth filters</li><li>Voice pipeline with spectral noise reduction</li><li>A/B comparison, WAV, CSV, HTML and PDF export</li></ul>
            <Link className="btn" to="/clearvoice/upload">Open ClearVoice <ArrowRight size={16} /></Link></article>
          <article className="card product" data-module="roadsonic"><h3>RoadSonic</h3><p>Emergency siren detection in noisy traffic recordings.</p>
            <ul><li>Frame features and dominant-frequency tracks</li><li>Interpretable rule-based candidate events with evidence</li><li>Timeline, event playback and review</li><li>Honest limits: an academic prototype, not a certified alert system</li></ul>
            <Link className="btn" to="/roadsonic/upload">Open RoadSonic <ArrowRight size={16} /></Link></article></div></section>

      <section className="section" aria-labelledby="preview"><h2 id="preview">Signal-processing preview</h2><div className="card"><FeaturePreview /></div></section>

      <section className="section" aria-labelledby="how"><h2 id="how">How SonicSense works</h2>
        <ol className="flow" style={{ padding: 0 }}><li><b>Upload</b><br /><span className="muted">The server validates the real file content.</span></li><li><b>Inspect</b><br /><span className="muted">Metadata, waveform, spectrum, spectrogram.</span></li>
          <li><b>Process</b><br /><span className="muted">Filter, enhance or extract features. The original stays untouched.</span></li><li><b>Compare</b><br /><span className="muted">A/B listening and aligned plots.</span></li><li><b>Export</b><br /><span className="muted">Audio, data and reports from real results.</span></li></ol></section>

      <section className="section" aria-labelledby="cap"><h2 id="cap">Technical capabilities</h2>
        <div className="grid2"><div className="card flat"><h3>Numerics</h3><p className="muted">NumPy and SciPy on full-resolution samples. Single-sided FFT with window calibration, STFT in dB re full scale, second-order-section IIR filters, causal or zero-phase.</p></div>
          <div className="card flat"><h3>Formats</h3><p className="muted">WAV, FLAC, OGG, AIFF and, with FFmpeg, MP3 and M4A. Mono and stereo; no silent resampling, normalization or clipping.</p></div>
          <div className="card flat"><h3>Local first</h3><p className="muted">Processing runs on your computer. No cloud service, database or GPU is required; audio is held in server memory for about an hour.</p></div></div></section>

      <section className="section" aria-labelledby="val"><h2 id="val">Validation and testing philosophy</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>Every number you see is computed from your file. Algorithms are tested against signals with known answers, limitations are documented rather than hidden, and the detector reports candidate events with the evidence behind them, never a certainty it cannot support.</p></section>
      <footer className="footer"><span>SonicSense · academic project · MATLAB is not used by the running application (Python/SciPy computes every result).</span><span><Link to="/docs">Documentation</Link> · <Link to="/how-it-works">How it works</Link></span></footer>
    </>
  );
}
