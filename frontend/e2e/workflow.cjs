/* Real-browser + real-backend checks (Playwright). Not part of `npm test`; needs the backend on :8000 and the dev server on :5173.
 *   node e2e/workflow.cjs <demo_audio_dir> [outDir]      (set NODE_PATH to the global node_modules containing playwright and axe-core)
 * Exits non-zero if any check fails. Every check is printed as PASS/FAIL with the measured value. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [, , DEMO, OUT = "e2e-out"] = process.argv;
const B = process.env.APP_URL || "http://127.0.0.1:5173", API = process.env.API_URL || "http://127.0.0.1:8000";
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const results = []; const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
fs.mkdirSync(OUT, { recursive: true });

async function axeScan(page, label) {
  await page.evaluate(axeSrc);
  const r = await page.evaluate(async () => (await axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].target.join(" ") })));
  const bad = r.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`axe ${label}: no serious/critical violations`, bad.length === 0, bad.map((v) => `${v.id}×${v.n} (${v.sample})`).join("; ") || `${r.length} minor/moderate`);
  return r;
}

(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[1366, 800], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), p = await ctx.newPage();
    const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160))); p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
    const overflow = async (label) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${w}px ${label}: no horizontal page scroll`, o <= 1, `overflow ${o}px`); };
    const next = async () => { await p.click(".wf-bar button.btn:not(:disabled)"); await p.waitForTimeout(2200); };
    await p.goto(B + "/"); await p.waitForSelector("h1");
    check(`${w}px landing H1 text`, (await p.textContent("h1")).replace(/\s+/g, " ").trim() === "Understand Every Signal. Hear What Matters.");
    await overflow("landing"); await axeScan(p, `${w}px landing`);
    await p.screenshot({ path: path.join(OUT, `${w}_landing.png`), fullPage: true });

    // keyboard: skip-to-content / tab order reaches the first CTA
    await p.keyboard.press("Tab"); const f1 = await p.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30));
    check(`${w}px keyboard focus starts on a visible control`, !!f1, f1);

    await p.goto(B + "/clearvoice/upload");
    await p.setInputFiles("input[type=file]", path.join(DEMO, "siren_in_traffic.wav")); await p.waitForSelector("text=Validated recording", { timeout: 20000 });
    await overflow("clearvoice upload"); await axeScan(p, `${w}px clearvoice upload`);
    await next(); await overflow("clearvoice overview"); await axeScan(p, `${w}px clearvoice overview`);
    check(`${w}px file size shown from the real upload`, /KB|MB/.test(await p.textContent(".meta-grid")));
    await next(); await next(); await overflow("clearvoice frequency");
    const peaksRows = await p.locator("text=Dominant spectral peaks").locator("xpath=..").locator("tbody tr").count();
    check(`${w}px one siren tone gives ≤2 listed peaks (not a leakage cluster)`, peaksRows >= 1 && peaksRows <= 2, `${peaksRows} rows`);
    await axeScan(p, `${w}px clearvoice frequency`);
    await next(); await next(); await overflow("clearvoice filter");
    await p.waitForSelector("[aria-label='Filter frequency response'] .js-plotly-plot", { timeout: 15000 });
    check(`${w}px filter response chart shows region labels`, (await p.textContent("[aria-label='Filter frequency response']")).includes("stopband"));
    await axeScan(p, `${w}px clearvoice filter`);
    await p.screenshot({ path: path.join(OUT, `${w}_clearvoice_filter.png`), fullPage: true });
    await p.click('button:has-text("Apply Filter")'); await p.waitForSelector("text=Latest result", { timeout: 30000 });
    await next(); await overflow("clearvoice comparison"); await axeScan(p, `${w}px clearvoice comparison`);
    await p.screenshot({ path: path.join(OUT, `${w}_clearvoice_comparison.png`), fullPage: true });

    // a NEW file must clear the previous file's results: deep-linking to the comparison step is redirected
    await p.goto(B + "/clearvoice/upload");
    await p.setInputFiles("input[type=file]", path.join(DEMO, "hi_lo_two_tone.wav")).catch(() => {});
    await p.waitForTimeout(2500);
    await p.goto(B + "/clearvoice/comparison"); await p.waitForTimeout(800);
    check(`${w}px new upload clears old filter result (comparison is gated)`, !p.url().endsWith("/comparison"), p.url().replace(B, ""));

    // RoadSonic
    await p.goto(B + "/roadsonic/upload"); await p.setInputFiles("input[type=file]", path.join(DEMO, "siren_in_traffic.wav")); await p.waitForSelector("text=Validated recording", { timeout: 20000 });
    await next(); await next(); await next(); await next();
    await p.click('button:has-text("Run candidate detection")'); await p.waitForTimeout(6000);
    await next(); await overflow("roadsonic events"); await axeScan(p, `${w}px roadsonic events`);
    await p.screenshot({ path: path.join(OUT, `${w}_roadsonic_events.png`), fullPage: true });
    check(`${w}px no console errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // ---- backend integration (no mocks): upload schema, filter output == downloaded WAV, events, errors leave nothing behind
  const wav = fs.readFileSync(path.join(DEMO, "siren_in_traffic.wav"));
  const fd = new FormData(); fd.append("file", new Blob([wav], { type: "audio/wav" }), "siren_in_traffic.wav");
  const up = await (await fetch(API + "/api/v1/audio/upload", { method: "POST", body: fd })).json();
  const need = ["audio_id", "sample_rate_hz", "channels", "samples_per_channel", "duration_s", "file_size_bytes"];
  check("upload response schema", need.every((k) => up.metadata?.[k] !== undefined) && Array.isArray(up.statistics?.per_channel) && !!up.waveform, `missing: ${need.filter((k) => up.metadata?.[k] === undefined)}`);
  check("file_size_bytes equals the uploaded byte count", up.metadata.file_size_bytes === wav.length, `${up.metadata.file_size_bytes} vs ${wav.length}`);
  const id = up.metadata.audio_id;
  const post = (p, b) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const fr = await (await post(`/api/v1/clearvoice/${id}/filter`, { filter_type: "lowpass", order: 4, cutoff_hz: [1000], method: "zero_phase" })).json();
  const dl = Buffer.from(await (await fetch(`${API}/api/v1/clearvoice/${fr.job_id}/download`)).arrayBuffer());
  const chunks = {}; for (let o = 12; o + 8 <= dl.length;) { const id4 = dl.slice(o, o + 4).toString(), sz = dl.readUInt32LE(o + 4); chunks[id4] = { at: o + 8, sz }; o += 8 + sz + (sz % 2); }
  const riff = dl.slice(0, 4).toString() === "RIFF" && dl.slice(8, 12).toString() === "WAVE" && !!chunks["fmt "] && !!chunks["data"];
  const dlRate = riff ? dl.readUInt32LE(chunks["fmt "].at + 4) : 0, dlCh = riff ? dl.readUInt16LE(chunks["fmt "].at + 2) : 0, dlBits = riff ? dl.readUInt16LE(chunks["fmt "].at + 14) : 8;
  const dlSamples = riff ? chunks["data"].sz / (dlBits / 8) / dlCh : 0;
  check("downloaded filtered WAV is a valid RIFF/WAVE with the original rate, channels and length", riff && dlRate === up.metadata.sample_rate_hz && dlCh === up.metadata.channels && dlSamples === up.metadata.samples_per_channel, `rate ${dlRate}, ${dlCh} ch, ${dlSamples} samples vs ${up.metadata.samples_per_channel}`);
  check("filter response carries phase_deg of the same length as the frequency grid", fr.response?.phase_deg?.length === fr.response?.freqs_hz?.length);
  const bad = await post(`/api/v1/clearvoice/${id}/filter`, { filter_type: "lowpass", order: 4, cutoff_hz: [99999], method: "causal" });
  check("invalid filter settings return 422 with a message, not a result", bad.status === 422 && !!(await bad.json()).detail);
  const rs = await (await post(`/api/v1/roadsonic/${id}/detect`, {})).json();
  check("RoadSonic detect returns an events array and a summary computed by the backend", Array.isArray(rs.events) && rs.summary?.n_events === rs.events.length, `${rs.events?.length} events`);
  const miss = await fetch(`${API}/api/v1/audio/doesnotexist/summary`); check("unknown audio id returns 404", miss.status === 404, String(miss.status));
  await browser.close();
  const failed = results.filter((x) => !x).length; console.log(`\n${results.length - failed}/${results.length} checks passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });
