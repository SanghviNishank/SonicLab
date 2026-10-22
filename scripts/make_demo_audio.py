"""Write synthetic demo recordings (siren in traffic-like noise, steady horn, noise only) as 16-bit WAVs into ./demo_audio.
Synthetic - for demonstrating the workflow, not evidence of real-world performance."""
import sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "tests"))
from synth import siren, tone, traffic_like, noise
FS, N = 16000, 16000 * 14
out = Path("demo_audio"); out.mkdir(exist_ok=True)
def save(name, x):
    x = x / max(1.0, np.max(np.abs(x)) / 0.9); wavfile.write(out / name, FS, (x * 32767).astype(np.int16)); print("wrote", out / name)
x = traffic_like(N, FS, 1, 0.25); x[3 * FS:8 * FS] += siren(FS, 5.0, 600, 1400, 0.5, 0.4); save("siren_in_traffic.wav", x)
h = traffic_like(N, FS, 2, 0.25); h[3 * FS:9 * FS] += tone(440, FS, 6.0, 0.4) + tone(550, FS, 6.0, 0.3); save("steady_horn_in_traffic.wav", h)
save("traffic_only.wav", traffic_like(N, FS, 3, 0.3) + noise(N, 4, 0.02))
