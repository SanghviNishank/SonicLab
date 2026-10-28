# SonicSense frontend

React 18 + TypeScript + Vite 5 single-page app for the two SonicSense labs, **ClearVoice** (analysis and filtering) and **RoadSonic** (candidate siren-event detection). It only displays numbers the FastAPI backend computed; nothing is simulated. RoadSonic is an academic prototype, not a safety system.

## Run (Windows PowerShell)

Two terminals, from the repository root (`signalsystem`).

```powershell
# Terminal 1 - backend
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000

# Terminal 2 - frontend
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173
```

If script execution is blocked: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` | Backend base URL. Set in `frontend/.env.local` (`VITE_API_URL=http://127.0.0.1:8000`) or `$env:VITE_API_URL="..."` before `npm run dev`. |
| `CS_CORS` (backend) | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins. |

No credentials or secrets are used or needed in the frontend.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run test` | Vitest + React Testing Library (jsdom, API mocked, Plotly mocked) |
| `npm run test:logic` | Node test runner for the pure logic modules in `src/logic` |
| `npm run test:all` | both of the above |
| `node e2e/workflow.cjs <demo_audio_dir>` | Real Chromium + real backend checks (see below) |

There is **no ESLint script**; type checking (`strict` TypeScript) is the static check.

### Real-browser / real-backend checks

`e2e/workflow.cjs` needs the backend on :8000 and `npm run dev` on :5173, plus `playwright` and `axe-core` resolvable (`NODE_PATH`). It uploads a real recording, walks the ClearVoice and RoadSonic workflows at 1366 px and 390 px, runs an axe-core scan on each page, checks horizontal overflow and the landing headline, and calls the API directly to verify the upload schema, `file_size_bytes`, that the downloaded filtered WAV is a valid RIFF/WAVE with the original sample rate, channels and length, that invalid settings return 422, and that RoadSonic returns events. It exits non-zero on any failure.

## Structure

```
src/
  api.ts                 central client: errors, cancellation (latest()), live in-flight counter
  context/Session.tsx    per-module session state, sessionStorage restore via /audio/{id}/summary
  logic/                 pure, unit-tested: workflow gating, filter validation, filter regions,
                         metadata rows, player key map, formatting, RoadSonic settings
  components/            charts/, audio/ (uploader, player, A/B player), workflow/ (shell, stepper, guard), ui/, hero/
  pages/                 HomePage, clearvoice/*, roadsonic/*, Info
  features/roadsonic/    event timeline and panels
  styles/tokens.css      design tokens (dark/light, per-module accent)
```

Routes: `/`, `/clearvoice/{upload,overview,time-analysis,frequency-analysis,spectrogram,filter,comparison,results}`, `/roadsonic/{upload,overview,preprocess,features,detect,events,review,summary}`, `/how-it-works`, `/docs`.

Step completion and locking are derived from real results (`logic/workflow.ts`); deep links to a step whose prerequisite is missing are redirected with a notice. Uploading a new file clears the previous file's results. Each request stream uses "latest wins" cancellation so a slow stale response cannot overwrite a newer one. Plotly is loaded lazily on the first chart (main bundle ≈ 315 kB, 103 kB gzip; the cartesian-only Plotly chunk is ≈ 1.4 MB, 474 kB gzip, fetched only when a chart is shown).

## Verified results (this build)

| Check | Result |
|---|---|
| `npm run typecheck` | passes |
| `npm run test` | 17 passed |
| `npm run test:logic` | 13 passed |
| `npm run build` | succeeds |
| `e2e/workflow.cjs` (Chromium, real backend) | 49/49 checks |
| Backend `pytest` | 327 passed |

## Known limitations

- The backend does not report processing percentage; progress bars for processing are indeterminate (upload progress is real).
- Filter phase chart is shown for causal filters only; zero-phase filtering has zero phase by construction.
- SNR is not shown for the filter: there is no clean reference, so only RMS and MSE between original and processed audio are reported.
- RoadSonic evaluation exists only where a labelled set is supplied to the backend; with none, the page says so. Detection rules are heuristic and can fire on horns, alarms or music.
- Spectrogram and spectrum charts use decimated display data; statistics use every sample.
- Audio is held in backend memory for about an hour; after that a reload returns to the upload step.
- Tested in headless Chromium only; Firefox/Safari were not run. Performance on an Intel i3 / 16 GB machine was not measured here (the bundle was kept small and Plotly lazy-loaded for that reason).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach the backend" | Start uvicorn on port 8000, or set `VITE_API_URL`. Header dot shows API status. |
| Upload rejected | File must be real audio, ≤ 50 MB, ≤ 5 min, ≤ 2 channels. MP3/M4A need FFmpeg on PATH. |
| Browser CORS error | Add your origin to `CS_CORS` on the backend. |
| HTTP 503 "busy" | The backend limits concurrent processing; retry after a few seconds. |
| `npm run dev` port in use | `npm run dev -- --port 5174` and add that origin to `CS_CORS`. |

## Screenshots

Captured from the running app (headless Chromium, real backend, `demo_audio/siren_in_traffic.wav`) in `docs/screenshots/`.
