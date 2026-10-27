# MATLAB status
Honest status: the running application uses **Python (NumPy/SciPy) for every computation**; the API labels results `python-scipy` / `python-numpy-fft`.
MATLAB reference functions in `matlab/functions` (spectrum, filter design) mirror the Python conventions and have a test script, but they have **not been executed** by the author of this scaffold.
Verification steps for you (PowerShell): `matlab -batch "ver"`, `license('test','Signal_Toolbox')`, then run `matlab/tests/run_tests.m`.
Only after `matlab.engine` imports in your Python version should an engine adapter be added to `backend/app/matlab/`.


---

## Milestone 4 additions (engine policy, verification)


SonicSense talks to MATLAB through the *MATLAB Engine for Python*. Engine selection is `CS_ENGINE`:

| value | behaviour |
|---|---|
| `python` (default) | Python only. MATLAB is never started. |
| `matlab` | MATLAB **required**. If it cannot run, the request fails with HTTP 503. Add `CS_ENGINE_FALLBACK=python` to allow an *explicit, reported* Python fallback. |
| `auto` | Try MATLAB; if it cannot run, use Python and report `fallback_used=true` with the reason. A failed start is not retried for 60 s. |

Every response carries `engine_info` = `{operation, configured_engine, engine_used, fallback_used, fallback_reason}`.
Operations that can run in MATLAB: spectrum (`calculate_single_sided_spectrum.m`), statistics (`calculate_audio_statistics.m`),
filter design (`design_digital_filter.m`, response evaluated with SciPy), signal comparison (`compare_signals.m`).

## 1. Check your installation (nothing here has been run by the author)
```powershell
# in MATLAB:   ver        (needs: Signal Processing Toolbox for butter/zp2sos)
python --version          # must be a version your MATLAB release supports for the Engine
pip install matlabengine  # or: cd "<matlabroot>\extern\engines\python"; python -m pip install .
python -c "import matlab.engine; e = matlab.engine.start_matlab(); print(e.version())"
```
## 2. Run the MATLAB-side tests (real MATLAB execution)
```powershell
cd D:\SonicLab\signalsystem\matlab\tests
matlab -batch "run_tests; compare_with_python"
```
`compare_with_python` reports "SKIPPED (not passed)" for filter design when the toolbox is missing.

## 3. Verify MATLAB against Python on a real upload (needs the server running with `CS_ENGINE=matlab`)
```powershell
$env:CS_ENGINE = "matlab"; cd backend; uvicorn app.main:app
# then GET /api/v1/clearvoice/{audio_id}/engine-verification
```
`comparison_performed=false` means MATLAB did not run and **nothing was validated**.
Tolerance: 1e-9 absolute (double precision in both; filter responses compared as |H|).
