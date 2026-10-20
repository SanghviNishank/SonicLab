# ClearVoice + RoadSonic (signalsystem)

Local web app: FastAPI + NumPy/SciPy backend, React/Vite/Plotly frontend. No database, Docker, cloud or paid API.

## Setup (Windows PowerShell, repo root)
```powershell
py --version; node --version; npm.cmd --version; git --version      # verify tools
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1      # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt
pytest                             # run automated tests
uvicorn app.main:app --reload --port 8000     # terminal 1 -> http://127.0.0.1:8000/docs
```
```powershell
cd frontend                        # terminal 2
npm.cmd install
npm.cmd run dev                    # http://localhost:5173
```
Limits (env-configurable): 50 MB file, 300 s, mono/stereo WAV only, in-memory store with 1 h TTL, max 50 items, single process.

## Status
See `docs/` and the chat summary. Implemented and tested: statistics, calibrated FFT, STFT, Butterworth filtering, comparison, rule-based siren detection (37 numerical tests). Written but not yet run: HTTP API tests, frontend, MATLAB functions.
Not yet done: HTML/PDF report, spectrogram CSV export, event overlay on spectrogram, synchronized A/B playback, academic documents, screenshots.
