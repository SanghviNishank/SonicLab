import { Link } from "react-router-dom";
import { ArrowRight, Cpu, Sliders, Activity, ShieldAlert, Sparkles, Volume2 } from "lucide-react";

export function Info({ kind = "how" }: { kind?: "how" }) {
  return (
    <div className="page stack">
      <div className="wf-head">
        <div>
          <div className="crumbs"><Link to="/">SignalSystem</Link> / Platform Architecture</div>
          <h1>How SignalSystem Operates</h1>
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="row" style={{ marginBottom: "0.5rem" }}>
            <Sliders size={20} className="text-cyan" />
            <h3 style={{ margin: 0 }}>ClearVoice Pipeline</h3>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Deterministic digital audio signal analysis and high-order IIR Butterworth filtering.
          </p>
          <ol style={{ paddingLeft: "1.2rem", lineHeight: 1.8 }}>
            <li><b>Upload & Validation:</b> Strict header and sample inspection (mono/stereo WAV, AIFF, FLAC).</li>
            <li><b>Time & Frequency Domain:</b> Calibrated RMS, crest factor, FFT spectrum, and STFT spectrograms.</li>
            <li><b>Second-Order Section (SOS) Filters:</b> Numerically stable Butterworth filtering (low-pass, high-pass, band-pass, notch) with zero-phase or causal options.</li>
            <li><b>A/B Evaluation & Export:</b> Aligned sample comparisons, metric calculation (MSE, SNR gain, peak delta), and 32-bit float / 16-bit PCM WAV export.</li>
          </ol>
          <Link className="btn" to="/clearvoice/upload" style={{ marginTop: "1rem" }}>
            Open ClearVoice <ArrowRight size={15} />
          </Link>
        </section>

        <section className="card" data-module="roadsonic">
          <div className="row" style={{ marginBottom: "0.5rem" }}>
            <Activity size={20} className="text-amber" />
            <h3 style={{ margin: 0 }}>RoadSonic Detector</h3>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Rule-based acoustic feature extraction and candidate emergency siren event isolation.
          </p>
          <ol style={{ paddingLeft: "1.2rem", lineHeight: 1.8 }}>
            <li><b>Acoustic Preprocessing:</b> DC offset removal, rumble high-pass, optional adaptive noise suppression.</li>
            <li><b>Time-Frequency Features:</b> Short-time RMS energy, spectral centroid, spectral bandwidth, dominant frequency tracking, and tonal harmonic ratio.</li>
            <li><b>Candidate Event Detection:</b> Multi-feature temporal consistency detector targeting classic wail and yelp frequency modulations (500–1800 Hz).</li>
            <li><b>Inspection & Timeline:</b> Interactive candidate intervals, feature trajectories, contextual audio playback, and CSV/JSON export.</li>
          </ol>
          <Link className="btn" to="/roadsonic/upload" style={{ marginTop: "1rem" }}>
            Open RoadSonic <ArrowRight size={15} />
          </Link>
        </section>
      </div>

      <section className="card stack">
        <div className="row">
          <Cpu size={20} className="text-violet" />
          <h3 style={{ margin: 0 }}>Core Engineering Principles</h3>
        </div>
        <div className="grid2 four">
          <div className="card flat">
            <b>Non-Destructive Processing</b>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
              Original audio buffers are kept immutable in memory. All filters, features, and spectrograms are re-calculated directly from original full-resolution samples.
            </p>
          </div>
          <div className="card flat">
            <b>No Fabricated Representations</b>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
              Every waveform, FFT peak, STFT cell, and detector interval reflects genuine calculations from real samples. Empty states are explicitly shown when audio is absent.
            </p>
          </div>
          <div className="card flat">
            <b>Filtering vs. Denoising</b>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
              Frequency filters attenuate spectral regions based on frequency cutoffs, not semantics. Overlapping speech and noise frequencies require honest spectral gating disclosures.
            </p>
          </div>
          <div className="card flat">
            <b>Academic Prototype Notice</b>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
              RoadSonic generates heuristic candidate events for research analysis and traffic acoustic modeling; it is not a safety-critical certified emergency response device.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
