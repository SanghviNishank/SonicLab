
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, AudioWaveform, Sliders, Activity, Sparkles, BarChart2, ShieldAlert, Cpu } from "lucide-react";
import HeroVisual from "../components/hero/HeroVisual";
import FeaturePreview from "../components/hero/FeaturePreview";
import type { SculptureMode } from "../components/hero/SoundSculpture";

export default function HomePage() {
  const [mode, setMode] = useState<SculptureMode>("idle");
  return (
    <>
      <section className="hero" aria-label="SignalSystem introduction">
        <HeroVisual mode={mode} />
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />SignalSystem — Intelligent Audio Analysis Lab</div>
          <h1>Understand Every Signal. <em>Hear What Matters.</em></h1>
          <p className="lead">An interactive audio intelligence laboratory for digital signal analysis, intelligent filtering, and emergency siren detection in noisy environments.</p>
          <div className="actions" style={{ margin: "1.5rem 0 1rem" }}>
            <a className="btn" href="#labs"><AudioWaveform size={16} /> Enter Audio Lab</a>
            <a className="btn ghost" href="#technology">Explore the Technology <ArrowRight size={16} /></a></div>
          <p className="muted illus-note" style={{ marginTop: "1.25rem", fontSize: ".78rem" }}>Illustration: the 3D ribbon is decorative, drawn from mathematical sine terms. It does not display your audio or any measurement.</p>
        </div>
      </section>

      <section className="section" aria-labelledby="labs"><h2 id="labs">Primary Audio Experiences</h2>
        <p className="muted" style={{ maxWidth: "75ch", marginBottom: "1.5rem" }}>
          SignalSystem provides two independent, research-grade signal-processing workflows. Select a laboratory below to begin.
        </p>
        <div className="grid2">
          <article className="card product" data-module="clearvoice">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <span className="chip ok" style={{ marginBottom: "0.4rem" }}>DSP & Audio Filtering</span>
                <h3 style={{ fontSize: "1.35rem", margin: "0.2rem 0" }}>ClearVoice</h3>
              </div>
              <Sliders size={28} className="text-cyan" style={{ opacity: 0.85 }} />
            </div>
            <p className="muted">Interactive audio signal analysis, frequency inspection, and high-order digital Butterworth filtering platform.</p>
            <ul>
              <li><b>Audio upload & validation:</b> Content, size, duration, sample rate, and channel integrity</li>
              <li><b>Waveform & statistical analysis:</b> Time-domain peaks, RMS power, crest factor, and DC offset</li>
              <li><b>FFT & frequency spectrum:</b> Single-sided calibrated magnitude spectrum with Nyquist reference</li>
              <li><b>Spectrogram analysis:</b> STFT time-frequency power distribution in calibrated dB</li>
              <li><b>Digital Butterworth filtering:</b> Low-pass, high-pass, band-pass, and band-stop / notch filters</li>
              <li><b>Original vs. filtered comparison:</b> Aligned A/B listening, synchronized plots, and MSE metrics</li>
              <li><b>Audio playback & WAV export:</b> 32-bit float or 16-bit PCM download with verified samples</li>
            </ul>
            <div style={{ marginTop: "1.5rem" }}>
              <Link className="btn" to="/clearvoice/upload" onMouseEnter={() => setMode("clearvoice")} onFocus={() => setMode("clearvoice")}>Open ClearVoice Lab <ArrowRight size={16} /></Link>
            </div>
          </article>

          <article className="card product" data-module="roadsonic">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <div>
                <span className="chip warn" style={{ marginBottom: "0.4rem" }}>Acoustic Event Detection</span>
                <h3 style={{ fontSize: "1.35rem", margin: "0.2rem 0" }}>RoadSonic</h3>
              </div>
              <Activity size={28} className="text-amber" style={{ opacity: 0.85 }} />
            </div>
            <p className="muted">Intelligent emergency siren detection in noisy urban traffic and automotive environments.</p>
            <ul>
              <li><b>Traffic-audio analysis:</b> Time-domain waveforms, calibrated spectra, and STFT spectrograms</li>
              <li><b>Acoustic feature extraction:</b> Spectral centroid, bandwidth, flatness, dominant-frequency tracks, and tonal ratio</li>
              <li><b>Temporal consistency detector:</b> Rule-based wail and yelp modulation detection across 500–1800 Hz</li>
              <li><b>Candidate event timelines:</b> Exact start, end, and duration with full acoustic evidence inspection</li>
              <li><b>Contextual event playback:</b> Audition isolated candidate siren intervals with surrounding road context</li>
              <li><b>Evidence reports & evaluation:</b> Ground-truth IoU evaluation, CSV/JSON metrics, and HTML/PDF reports</li>
              <li><b>Machine learning classification:</b> Framework-ready feature extraction and evaluation integration</li>
            </ul>
            <div style={{ marginTop: "1.5rem" }}>
              <Link className="btn" to="/roadsonic/upload" onMouseEnter={() => setMode("roadsonic")} onFocus={() => setMode("roadsonic")}>Open RoadSonic Lab <ArrowRight size={16} /></Link>
            </div>
          </article>
        </div>
      </section>

      <section className="section" id="technology" aria-labelledby="cap"><h2 id="cap">Platform Capabilities</h2>
        <div className="grid2 four">
          <div className="card flat">
            <div className="row" style={{ marginBottom: "0.4rem" }}><BarChart2 size={18} className="text-cyan" /><b style={{ fontSize: "1.05rem" }}>Signal Analysis</b></div>
            <p className="muted">Time-domain statistics, single-sided FFT with window calibration (Hann/Rectangular), and STFT spectrograms in dB relative to full scale.</p>
          </div>
          <div className="card flat">
            <div className="row" style={{ marginBottom: "0.4rem" }}><Sliders size={18} className="text-violet" /><b style={{ fontSize: "1.05rem" }}>Intelligent Filtering</b></div>
            <p className="muted">Second-order-section Butterworth IIR filters, causal or zero-phase, with the designed response shown before anything is applied.</p>
          </div>
          <div className="card flat">
            <div className="row" style={{ marginBottom: "0.4rem" }}><Activity size={18} className="text-amber" /><b style={{ fontSize: "1.05rem" }}>Siren Detection</b></div>
            <p className="muted">Sustained, modulated tonal energy in the siren band is turned into candidate events. Horns, alarms and music can also trigger it.</p>
          </div>
          <div className="card flat">
            <div className="row" style={{ marginBottom: "0.4rem" }}><Cpu size={18} className="text-mint" /><b style={{ fontSize: "1.05rem" }}>Local Processing</b></div>
            <p className="muted">Everything is computed by the Python backend on your computer. Formats: WAV, FLAC, OGG, AIFF, and MP3/M4A when FFmpeg is installed. Mono or stereo, no silent resampling.</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="how"><h2 id="how">Standard Workflow</h2>
        <ol className="flow" style={{ padding: 0 }}>
          <li><b>Upload & Verify</b><br /><span className="muted">The server validates true audio headers and samples.</span></li>
          <li><b>Inspect Signal</b><br /><span className="muted">Full metadata, waveforms, FFT spectrum, and spectrogram.</span></li>
          <li><b>Process & Detect</b><br /><span className="muted">Apply SOS filters or extract acoustic candidate features.</span></li>
          <li><b>Compare & Review</b><br /><span className="muted">A/B audio listening, synchronized plots, and event review.</span></li>
          <li><b>Export Results</b><br /><span className="muted">Download pristine WAVs, structured CSV/JSON, or full reports.</span></li>
        </ol>
      </section>

      <section className="section" aria-labelledby="concepts"><h2 id="concepts">Signal-Processing Concepts</h2>
        <div className="grid2">
          <div className="card flat">
            <h3>Sampling Period & Nyquist</h3>
            <p className="eq">x[n] = x(n·Ts), Ts = 1/fs</p>
            <p className="muted">Continuous sound pressure is sampled at interval Ts seconds. The Nyquist frequency fn = fs/2 is the highest unaliased frequency that can be represented.</p>
          </div>
          <div className="card flat">
            <h3>Discrete Fourier Transform</h3>
            <p className="eq">X[k] = Σ x[n]·e<sup>−j2πkn/N</sup></p>
            <p className="muted">Transforms N time-domain samples into N/2+1 discrete frequency bins spaced fs/N Hz apart. Windows (Hann, rectangular) balance frequency resolution against spectral leakage.</p>
          </div>
          <div className="card flat">
            <h3>Short-Time Fourier Transform (STFT)</h3>
            <p className="eq">S(m,k) = |STFT{"{x}"}|</p>
            <p className="muted">Computes localized spectra across sliding, overlapping time frames. Visualizes non-stationary acoustic signals such as sweeping sirens and speech formants.</p>
          </div>
          <div className="card flat">
            <h3>IIR Butterworth Filtering</h3>
            <p className="eq">y[n] = Σ b<sub>i</sub>x[n−i] − Σ a<sub>j</sub>y[n−j]</p>
            <p className="muted">Provides a maximally flat passband without passband ripple. Computed via cascaded second-order sections (SOS) for numerical stability.</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="preview"><h2 id="preview">Signal-Processing Preview</h2>
        <div className="card"><FeaturePreview /></div>
      </section>

      <section className="section" aria-labelledby="arch"><h2 id="arch">Shared Architecture</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>Both labs share one upload service, one audio store, one analysis library (FFT, STFT, statistics) and one design system. They remain separate experiences: ClearVoice changes the audio, RoadSonic only analyses it.</p>
        <ol className="flow" style={{ padding: 0 }}>
          <li><b>React + Vite Interface</b><br /><span className="muted">Guided steps, Plotly interactive charts, fluid transitions.</span></li>
          <li><b>FastAPI Backend Service</b><br /><span className="muted">High-performance asynchronous endpoints under /api/v1.</span></li>
          <li><b>NumPy / SciPy Signal Engine</b><br /><span className="muted">Rigorous numerical mathematics with MATLAB compatibility.</span></li>
        </ol>
      </section>

      <section className="section" id="limits" aria-labelledby="limits"><h2 id="limits">Limitations and academic use</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          SonicSense is an educational and academic project. RoadSonic reports <em>candidate</em> events from hand-written rules and has not been validated as a safety system; do not rely on it for emergency alerts or driving decisions. Filter metrics compare your original with the processed file and do not by themselves prove better quality. MATLAB scripts in the repository are reference material; the running application uses Python.
        </p>
      </section>

      <footer className="footer">
        <span>SignalSystem — Intelligent Audio Analysis Lab</span>
        <nav aria-label="Footer">
          <Link to="/clearvoice/upload">ClearVoice</Link> · <Link to="/roadsonic/upload">RoadSonic</Link> · <Link to="/how-it-works">How it works</Link> · <a href="#limits">Limitations</a>
        </nav>
      </footer>
    </>
  );
}
