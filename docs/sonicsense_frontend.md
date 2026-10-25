# SonicSense frontend (routes, session model, design system, test report)

## Routes (all in the same browser tab; no `target="_blank"` anywhere)
`/` landing · `/how-it-works` · `/docs`
ClearVoice: `/clearvoice/{upload, overview, time-analysis, frequency-analysis, spectrogram, filter, comparison, results}`
RoadSonic: `/roadsonic/{upload, overview, preprocess, features, detect, events, review, summary}`
`/clearvoice` and `/roadsonic` redirect to `upload`. Browser back/forward work (React Router).

## Workflow rules (`src/logic/workflow.ts`, unit-tested)
* **Prerequisites:** a step opened without its prerequisites (pasted link, refresh) redirects to the furthest legal step with an explanation. Comparison/Results need a processing result; RoadSonic Events/Review/Summary need an explicit detection run.
* **Completion reflects data, not clicks:** processing steps (upload, filter, detect) complete when their result exists; viewing steps complete only when the screen rendered real backend data (`useMarkLoaded`). Status per step: not started / current / completed / locked.
* **RoadSonic honesty:** upload runs an *analysis* with default settings (spectra and features) but events stay hidden until the Detect step is run on purpose.

## Session model (`src/context/Session.tsx`)
State lives in React context so Back/Next never loses work. `sessionStorage` holds only `{audioId, filename, settings, savedAt}` (never audio). After a reload the recording is re-fetched from `GET /api/v1/audio/{id}/summary`; if the server's 1-hour TTL has passed, the user is told the session expired. `localStorage` holds only the theme preference. Browser object URLs are not used (audio is streamed from the API).

## Backend additions for the new workflow
`GET /audio/{id}/summary` (session restore) · `POST /audio/{id}/range-stats` (exact statistics of a zoomed range from full-resolution samples) · `POST /clearvoice/{id}/filter/preview` (theoretical response before applying).

## Design system
Tokens in `src/styles/tokens.css` (colour, spacing, radii, shadow, motion, chart colours). Dark is primary; light is complete. Module identity via `data-module`: ClearVoice cyan/violet, RoadSonic amber-led (amber is reserved for candidate events in charts). Fonts: Inter if installed, else Segoe UI/system (no web-font download). Motion: short fade/slide per page; all animation disabled under `prefers-reduced-motion`.
3D hero: `three` (lazy-loaded, landing page only), ribbon landscape driven by sine terms (decorative, labelled as such), ~30 fps, paused off-screen, one static frame under reduced motion, SVG fallback when WebGL is missing or the screen is narrow.

## Test report (sandbox, Node 22, Python 3.12)
| Check | Result |
|---|---|
| Backend suite (`pytest`-style runner) | see `implementation_status.md` |
| Frontend logic tests: `npm run test:logic` (Node built-in runner) | 9 tests pass: formatting, filter validation, workflow prerequisites/redirects/completion, RoadSonic settings, session persistence safety, demo-signal numerics |
| Bracket balance + relative-import resolution, all 45 `.ts/.tsx` files | 0 problems |
| `tsc --noEmit`, `vite build`, browser run, console errors, responsive layout, 3D scene, A/B playback, downloads | **NOT RUN** (no npm/network/browser in the sandbox) |
| New API routes and validation (pydantic) | tests written, **not run** (FastAPI/pydantic not installable here) |
| Component/DOM tests (React Testing Library/Vitest), end-to-end browser tests | **not written** |

## Known gaps
No synchronized playhead on ClearVoice plots; A/B playback is not gain-matched (stated in the UI); no resizable panels; mobile bottom navigation is a collapsible top menu; light-theme contrast not audited with a tool; ML classifier absent; MATLAB not executed.
