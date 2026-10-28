import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, AudioWaveform } from "lucide-react";
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
          <div className="eyebrow">SonicSense · audio intelligence laboratory</div>
          <h1>Understand Every Signal. <em>Hear What Matters.</em></h1>
          <p className="lead">An interactive audio intelligence laboratory for digital signal analysis, intelligent filtering, and emergency siren detection in noisy environments.</p>
          <div className="actions" style={{ margin: "1.5rem 0 1rem" }}>
            <a className="btn" href="#labs"><AudioWaveform size={16} /> Enter Audio Lab</a>
            <a className="btn ghost" href="#technology">Explore the Technology <ArrowRight size={16} /></a></div>
          <p className="muted illus-note" style={{ marginTop: "1.25rem", fontSize: ".78rem" }}>Illustration: the 3D ribbon is decorative, drawn from mathematical sine terms. It does not display your audio or any measurement.</p>
        </div>
      </section>

      <section className="section" aria-labelledby="labs"><h2 id="labs">Choose a lab</h2>
        <div className="grid2">
          <article className="card product" data-module="clearvoice"><h3>ClearVoice</h3><p>Digital signal analysis and filtering for speech and general audio.</p>
            <ul><li>Waveform, calibrated FFT spectrum and spectrogram</li><li>Low-pass, high-pass, band-pass and band-stop Butterworth filters with a validated design</li><li>Before/after A/B listening and WAV download</li><li>Measured RMS and MSE between original and processed audio</li></ul>
            <Link className="btn" to="/clearvoice/upload" onMouseEnter={() => setMode("clearvoice")} onFocus={() => setMode("clearvoice")}>Open ClearVoice Lab <ArrowRight size={16} /></Link></article>
          <article className="card product" data-module="roadsonic"><h3>RoadSonic</h3><p>Candidate emergency-siren detection in noisy traffic recordings.</p>
            <ul><li>Frame features and dominant-frequency tracks</li><li>Interpretable rule-based candidate events with the evidence behind each one</li><li>Timeline synchronised with waveform and spectrogram; review and playback</li><li>An academic prototype, not a certified alert system</li></ul>
            <Link className="btn" to="/roadsonic/upload" onMouseEnter={() => setMode("roadsonic")} onFocus={() => setMode("roadsonic")}>Open RoadSonic Lab <ArrowRight size={16} /></Link></article></div></section>

      <section className="section" id="technology" aria-labelledby="cap"><h2 id="cap">Capabilities</h2>
        <div className="grid2 four"><div className="card flat"><h3>Signal analysis</h3><p className="muted">Time-domain statistics, single-sided FFT with window calibration, and STFT spectrograms in dB relative to full scale.</p></div>
          <div className="card flat"><h3>Intelligent filtering</h3><p className="muted">Second-order-section Butterworth IIR filters, causal or zero-phase, with the designed response shown before anything is applied.</p></div>
          <div className="card flat"><h3>Siren detection</h3><p className="muted">Sustained, modulated tonal energy in the siren band is turned into candidate events. Horns, alarms and music can also trigger it.</p></div>
          <div className="card flat"><h3>Local processing</h3><p className="muted">Everything is computed by the Python backend on your computer. Formats: WAV, FLAC, OGG, AIFF, and MP3/M4A when FFmpeg is installed. Mono or stereo, no silent resampling.</p></div></div></section>

      <section className="section" aria-labelledby="how"><h2 id="how">Workflow</h2>
        <ol className="flow" style={{ padding: 0 }}><li><b>Upload</b><br /><span className="muted">The server validates the real file content.</span></li><li><b>Inspect</b><br /><span className="muted">Metadata, waveform, spectrum, spectrogram.</span></li>
          <li><b>Process</b><br /><span className="muted">Filter, or extract features and detect. The original stays untouched.</span></li><li><b>Compare / review</b><br /><span className="muted">A/B listening, aligned plots, event review.</span></li><li><b>Export</b><br /><span className="muted">Audio, data and reports from real results.</span></li></ol></section>

      <section className="section" aria-labelledby="concepts"><h2 id="concepts">Signal-processing concepts</h2>
        <div className="grid2">
          <div className="card flat"><h3>Sampling</h3><p className="eq">x[n] = x(n·Ts), Ts = 1/fs</p><p className="muted">Sound pressure is measured every Ts seconds. The Nyquist frequency fs/2 is the highest frequency a sampled signal can represent.</p></div>
          <div className="card flat"><h3>DFT / FFT</h3><p className="eq">X[k] = Σ x[n]·e<sup>−j2πkn/N</sup></p><p className="muted">Re-expresses N samples as amplitude at N/2+1 frequencies spaced fs/N apart. A window (Hann, rectangular) trades main-lobe width against leakage.</p></div>
          <div className="card flat"><h3>Spectrogram</h3><p className="eq">S(m,k) = |STFT{"{x}"}|</p><p className="muted">Short overlapping frames show how the spectrum changes over time. A longer frame resolves frequency better and time worse.</p></div>
          <div className="card flat"><h3>Filtering</h3><p className="eq">y[n] = Σ b<sub>i</sub>x[n−i] − Σ a<sub>j</sub>y[n−j]</p><p className="muted">A Butterworth filter has a maximally flat passband. Order sets the transition steepness. Forward-backward filtering gives zero phase but is noncausal.</p></div></div></section>

      <section className="section" aria-labelledby="preview"><h2 id="preview">Signal-processing preview</h2><div className="card"><FeaturePreview /></div></section>

      <section className="section" aria-labelledby="arch"><h2 id="arch">Shared architecture</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>Both labs share one upload service, one audio store, one analysis library (FFT, STFT, statistics) and one design system. They remain separate experiences: ClearVoice changes the audio, RoadSonic only analyses it.</p>
        <ol className="flow" style={{ padding: 0 }}><li><b>React interface</b><br /><span className="muted">Guided steps, charts, playback.</span></li><li><b>FastAPI service</b><br /><span className="muted">Validated requests under /api/v1.</span></li><li><b>NumPy / SciPy core</b><br /><span className="muted">Every number is computed here.</span></li></ol></section>

      <section className="section" aria-labelledby="limits"><h2 id="limits">Limitations and academic use</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>SonicSense is an educational and academic project. RoadSonic reports <em>candidate</em> events from hand-written rules and has not been validated as a safety system; do not rely on it for emergency alerts or driving decisions. Filter metrics compare your original with the processed file and do not by themselves prove better quality. MATLAB scripts in the repository are reference material; the running application uses Python.</p></section>
      <footer className="footer"><span>SonicSense · academic project</span>
        <nav aria-label="Footer"><Link to="/clearvoice/upload">ClearVoice</Link> · <Link to="/roadsonic/upload">RoadSonic</Link> · <Link to="/how-it-works">How it works</Link> · <Link to="/docs">Documentation</Link> · <a href="#limits">Limitations</a></nav></footer>
    </>
  );
}
