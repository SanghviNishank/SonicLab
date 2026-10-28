"""Backend benchmark: wall time, real-time factor (RTF = processing time / audio duration) and peak memory.

Every scenario runs in a FRESH subprocess so that ru_maxrss (peak resident set size of that process) is not
contaminated by earlier scenarios. Requests go through the real FastAPI app via TestClient (no network).
Signals are synthetic with a fixed seed. Nothing here is estimated: numbers are measured on the machine that runs it.

    cd backend
    python ../scripts/benchmark_backend.py                 # default scenarios, prints a markdown table
    python ../scripts/benchmark_backend.py --json out.json # also writes raw results
"""
from __future__ import annotations
import argparse, io, json, os, platform, resource, subprocess, sys, time

BACKEND = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

# (label, sample_rate, channels, duration_s, wav subtype). The last scenario is sized just under the default 50 MB upload limit.
SCENARIOS = [("10 s mono 16 kHz", 16000, 1, 10, "FLOAT"), ("60 s stereo 44.1 kHz", 44100, 2, 60, "FLOAT"),
             ("277 s stereo 44.1 kHz 16-bit (~49 MB, size limit)", 44100, 2, 277, "PCM_16")]
OPS = ["upload", "analyze", "filter_bandpass_zero_phase", "filter_lowpass_causal", "voice_lecture_speech", "roadsonic_detect", "download_float32"]


def _rss_mb() -> float:
    """Current (not peak) resident set size in MB, from /proc (Linux)."""
    try:
        with open("/proc/self/statm") as f: return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 2**20
    except Exception: return float("nan")


def _child(fs: int, ch: int, dur: float, subtype: str) -> None:
    import numpy as np, soundfile as sf
    sys.path[:0] = [BACKEND, os.path.join(BACKEND, "tests")]
    from fastapi.testclient import TestClient
    from app.main import app
    rng = np.random.default_rng(12345)
    t = np.arange(int(fs * dur)) / fs
    base = 0.2 * np.sin(2 * np.pi * 440 * t) + 0.05 * rng.standard_normal(t.size)
    x = np.column_stack([base, 0.8 * base]) if ch == 2 else base
    buf = io.BytesIO(); sf.write(buf, x, fs, format="WAV", subtype=subtype); data = buf.getvalue()
    c = TestClient(app)
    res: dict = {"file_mb": len(data) / 2**20, "ops": {}}

    def timed(name, fn):
        t0 = time.perf_counter(); r = fn(); dt = time.perf_counter() - t0
        res["ops"][name] = {"seconds": dt, "rtf": dt / dur, "status": r.status_code, "response_mb": len(r.content) / 2**20,
                            "rss_peak_mb_so_far": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024}
        return r
    r = timed("upload", lambda: c.post("/api/v1/audio/upload", files={"file": ("b.wav", data, "audio/wav")}))
    aid = r.json()["metadata"]["audio_id"]
    timed("analyze", lambda: c.post(f"/api/v1/clearvoice/{aid}/analyze", json={}))
    r = timed("filter_bandpass_zero_phase", lambda: c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "bandpass", "order": 4, "cutoff_hz": [300, 3400], "method": "zero_phase"}))
    job = r.json().get("job_id")
    timed("filter_lowpass_causal", lambda: c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 4, "cutoff_hz": [4000], "method": "causal"}))
    timed("voice_lecture_speech", lambda: c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "lecture_speech"}))
    timed("roadsonic_detect", lambda: c.post(f"/api/v1/roadsonic/{aid}/detect", json={}))
    if job:
        timed("download_float32", lambda: c.get(f"/api/v1/clearvoice/{job}/download"))
    # Retention: how much does resident memory grow per additional stored processing result?
    rss_now = lambda: _rss_mb()
    before = rss_now()
    for _ in range(5):
        c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 4, "cutoff_hz": [4000], "method": "causal"})
    res["rss_growth_per_extra_filter_job_mb"] = (rss_now() - before) / 5
    res["rss_peak_mb_final"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print("RESULT_JSON " + json.dumps(res))


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--json"); ap.add_argument("--child", nargs=4); ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    if a.child:
        _child(int(a.child[0]), int(a.child[1]), float(a.child[2]), a.child[3]); return
    scen = SCENARIOS[:2] if a.quick else SCENARIOS
    out = {"environment": {"python": platform.python_version(), "platform": platform.platform(), "cpus": os.cpu_count()}, "scenarios": {}}
    try:
        import numpy, scipy, fastapi; out["environment"].update(numpy=numpy.__version__, scipy=scipy.__version__, fastapi=fastapi.__version__)
    except Exception: pass
    for label, fs, ch, dur, sub in scen:
        p = subprocess.run([sys.executable, os.path.abspath(__file__), "--child", str(fs), str(ch), str(dur), sub], capture_output=True, text=True)
        line = next((l for l in p.stdout.splitlines() if l.startswith("RESULT_JSON ")), None)
        if not line:
            out["scenarios"][label] = {"error": (p.stderr or p.stdout)[-600:]}; continue
        out["scenarios"][label] = json.loads(line[len("RESULT_JSON "):])
    print(f"Environment: {out['environment']}\n")
    print("| Scenario | Operation | HTTP | Time (s) | RTF | Response (MB) |\n|---|---|---|---|---|---|")
    for label, r in out["scenarios"].items():
        if "error" in r: print(f"| {label} | FAILED | | | | {r['error'][:80]!r} |"); continue
        for op, v in r["ops"].items():
            print(f"| {label} (file {r['file_mb']:.1f} MB) | {op} | {v['status']} | {v['seconds']:.2f} | {v['rtf']:.3f} | {v['response_mb']:.2f} |")
        print(f"| {label} | **peak RSS of whole process** | | | | {r['rss_peak_mb_final']:.0f} MB |")
        print(f"| {label} | **RSS growth per extra stored filter job** | | | | {r['rss_growth_per_extra_filter_job_mb']:.0f} MB |")
    if a.json:
        with open(a.json, "w") as f: json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
