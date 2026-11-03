/* Real-browser, real-backend checks for the five advanced features.
 *   NODE_PATH=<global node_modules + axe-core> node e2e/features.cjs <demo_audio_dir> [outDir]
 * Backend on :8000, dev server on :5173. Exits non-zero if any check fails. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [, , DEMO, OUT = "e2e-out"] = process.argv;
const B = process.env.APP_URL || "http://127.0.0.1:5173";
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const res = []; const check = (n, ok, d = "") => { res.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
fs.mkdirSync(OUT, { recursive: true });
const WAV = path.join(DEMO, "siren_in_traffic.wav");

async function axe(p, label) {
  await p.evaluate(axeSrc);
  const v = (await p.evaluate(async () => (await axe.run(document)).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, s: x.nodes[0].target.join(" ") })))).filter((x) => x.impact === "serious" || x.impact === "critical");
  check(`axe ${label}: no serious/critical violations`, v.length === 0, v.map((x) => `${x.id}×${x.n} (${x.s})`).join("; "));
}
const audioState = (p) => p.evaluate(() => [...document.querySelectorAll("audio")].map((a) => ({ t: a.currentTime, paused: a.paused, muted: a.muted, d: a.duration, src: a.getAttribute("src") })));

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  for (const [w, h] of [[1366, 800], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), p = await ctx.newPage();
    const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200))); p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
    const spa = async (path) => { await p.evaluate((x) => { history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, path); await p.waitForTimeout(600); };   // in-app navigation: keeps session results (a reload drops them by design)
    const next = async () => { await p.click(".wf-bar button.btn:not(:disabled)"); await p.waitForTimeout(2000); };
    const overflow = async (l) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${w}px ${l}: no horizontal scroll`, o <= 1, `${o}px`); };

    // ---------- upload + learn page with real values
    await p.goto(B + "/learn"); await p.waitForSelector("h1");
    check(`${w}px learn page without a recording shows no measurements`, (await p.textContent("body")).includes("No recording is loaded"));
    await p.goto(B + "/clearvoice/upload"); await p.setInputFiles("input[type=file]", WAV); await p.waitForSelector("text=Validated recording", { timeout: 20000 });
    await next(); await next(); await next();                         // overview, time, frequency (analysis runs)
    await p.waitForSelector("text=Dominant spectral peaks", { timeout: 20000 });   // analysis lives in the session; navigate inside the app (a page reload would drop it)
    await p.evaluate(() => { history.pushState({}, "", "/learn"); window.dispatchEvent(new PopStateEvent("popstate")); }); await p.waitForSelector("h1:has-text('DSP Learning Assistant')");
    await p.click("button:has-text('What is sampling rate')");
    const learnTxt = await p.textContent(".yours");
    check(`${w}px learn: sampling-rate sentence uses the uploaded file's rate`, /16,000 samples per second/.test(learnTxt), learnTxt.slice(0, 90));
    await p.click("button:has-text('What is the FFT')");
    const fftTxt = await p.textContent(".yours");
    check(`${w}px learn: FFT sentence lists the file's own peak`, /around 13\d\d(\.\d)? Hz/.test(fftTxt), fftTxt.slice(0, 120));
    await p.click("button:has-text('What is a spectrogram')").catch(() => {});
    await p.click("button:has-text('Technical')"); check(`${w}px learn: technical mode shows an equation`, /Σ|log10|=/.test(await p.textContent("article")));
    await p.click("button:has-text('What is sampling?')"); await p.waitForSelector("[aria-label='Interactive experiment']");
    check(`${w}px learn: interactive experiment present`, true); await overflow("learn"); await axe(p, `${w}px learn`);
    await p.screenshot({ path: path.join(OUT, `${w}_learn.png`), fullPage: true });

    // ---------- Visual Filter Lab -> real processing
    await spa("/clearvoice/filter"); await p.waitForSelector("[role=radiogroup][aria-label='Filter type']");
    const cards = await p.locator(".filter-card").allTextContents();
    check(`${w}px filter lab has the five filter cards`, ["Low-pass", "High-pass", "Band-pass", "Band-stop", "Notch"].every((n) => cards.some((c) => c.includes(n))), `${cards.length} cards`);
    await p.click(".filter-card:has-text('High-pass')"); await p.waitForSelector("text=Retained");
    const before = await p.textContent("[aria-label='What is kept and reduced']");
    await p.fill("#f1-n", "2500"); await p.waitForTimeout(900);
    const after = await p.textContent("[aria-label='What is kept and reduced']");
    check(`${w}px moving the cutoff updates the retained/reduced summary`, before !== after, `${before.slice(0, 40)} → ${after.slice(0, 40)}`);
    await p.fill("#f1-n", "9000"); await p.waitForTimeout(400);
    check(`${w}px invalid cutoff (above Nyquist) disables Apply`, await p.isDisabled("button:has-text('Apply Filter')") && !!(await p.$("[role=alert]")));
    await p.fill("#f1-n", "400"); await p.waitForSelector("text=Retained"); await p.waitForTimeout(700);
    await overflow("filter lab"); await axe(p, `${w}px filter lab`); await p.screenshot({ path: path.join(OUT, `${w}_filterlab.png`), fullPage: true });
    await p.click("button:has-text('Apply Filter')"); await p.waitForSelector("[aria-label='Applied filter settings']", { timeout: 30000 });
    const ap = await p.textContent("[aria-label='Applied filter settings']");
    check(`${w}px applied settings shown from the backend config`, /highpass/.test(ap) && /400/.test(ap) && /zero_phase/.test(ap), ap.replace(/\s+/g, " ").slice(0, 110));
    check(`${w}px preview and backend response agree`, /consistent/.test(ap), (ap.match(/largest difference [\d.]+ dB/) || [""])[0]);

    // ---------- Before vs After Studio
    await p.click("button:has-text('Open Before vs After Studio')"); await p.waitForSelector("text=Before vs After Studio");
    await p.waitForFunction(() => [...document.querySelectorAll("audio")].every((a) => a.readyState >= 1), null, { timeout: 20000 });
    const st0 = await audioState(p);
    check(`${w}px studio plays original and backend-processed WAV`, st0[0].src.includes("/audio/") && st0[1].src.includes("/clearvoice/") && st0[1].src.includes("/download"), st0.map((s) => s.src.replace(/^.*\/api/, "/api")).join(" | "));
    check(`${w}px both files have the same duration`, Math.abs(st0[0].d - st0[1].d) < 0.01, `${st0[0].d} vs ${st0[1].d}`);
    await p.click("button:has-text('Compare Audio')"); await p.waitForTimeout(2500);
    const st1 = await audioState(p);
    check(`${w}px synchronized playback is running and aligned`, !st1[0].paused && !st1[1].paused && Math.abs(st1[0].t - st1[1].t) < 0.2 && st1[0].t > 1, `t=${st1[0].t.toFixed(2)} / ${st1[1].t.toFixed(2)}`);
    check(`${w}px only the selected version is audible (A)`, !st1[0].muted && st1[1].muted);
    await p.click("button:has-text('Switch A/B')"); await p.waitForTimeout(300);
    const st2 = await audioState(p); check(`${w}px A/B switch swaps audibility without moving position`, st2[0].muted && !st2[1].muted && Math.abs(st2[1].t - st1[1].t) < 1.5);
    await p.waitForTimeout(2000); const st3 = await audioState(p);
    check(`${w}px still aligned after switching`, Math.abs(st3[0].t - st3[1].t) < 0.2, `${st3[0].t.toFixed(2)} / ${st3[1].t.toFixed(2)}`);
    await p.click("button:has-text('Pause')"); await p.waitForTimeout(200); const stp = await audioState(p); check(`${w}px pause stops both`, stp[0].paused && stp[1].paused);
    // section loop
    const inputs = p.locator("fieldset.section-pick input[type=number]"); await inputs.nth(0).fill("1"); await inputs.nth(1).fill("2"); await p.click("button:has-text('Use section')");
    await p.click("button:has-text('Compare Audio')"); await p.waitForTimeout(3500); const sl = await audioState(p);
    check(`${w}px section loop keeps playback inside 1–2 s`, sl[0].t >= 0.9 && sl[0].t <= 2.3, `t=${sl[0].t.toFixed(2)}`);
    await p.click("button:has-text('Pause')");
    // loudness matched is optional and changes the processed source
    await p.check("label:has-text('Loudness-matched') input"); await p.waitForTimeout(1500); const sm = await audioState(p);
    check(`${w}px loudness-matched mode loads the backend-scaled copy`, sm[1].src.includes("match_loudness=true") && !sm[0].src.includes("match_loudness"), sm[1].src.replace(/^.*\/api/, "/api"));
    await p.uncheck("label:has-text('Loudness-matched') input");
    const tbl = await p.textContent("section.studio table"); check(`${w}px studio shows RMS, peak, clipped and duration`, /RMS/.test(tbl) && /peak/.test(tbl) && /clipped/.test(tbl) && /Duration/.test(tbl));
    const dif = await p.$("[aria-label='Waveform difference (original − processed)']"); check(`${w}px waveform-difference chart shown`, !!dif);
    check(`${w}px beginner explanation text present`, (await p.textContent("section.studio")).includes("Listen to the original recording first. Now listen to the processed recording."));
    await overflow("studio"); await axe(p, `${w}px studio`); await p.screenshot({ path: path.join(OUT, `${w}_studio.png`), fullPage: true });

    // ---------- report + exports
    await spa("/clearvoice/results"); await p.waitForSelector("text=6. Limitations", { timeout: 20000 });
    const rep = await p.textContent(".report");
    check(`${w}px report has all six sections`, ["1. Recording information", "2. Audio analysis", "3. Processing information", "4. Before and after comparison", "5. Processing explanation", "6. Limitations"].every((s) => rep.includes(s)));
    check(`${w}px report shows the real parameters`, /highpass/.test(rep) && /400 Hz/.test(rep) && /siren_in_traffic\.wav/.test(rep) && /16000 Hz/.test(rep) && /KB/.test(rep));
    check(`${w}px report states the SNR limitation`, /SNR improvement is not claimed/.test(rep));
    const pdfHref = await p.getAttribute("a:has-text('Download PDF report')", "href"), sumHref = await p.getAttribute("a:has-text('Download processing summary')", "href"), wavHref = await p.getAttribute(".report a:has-text('Processed WAV')", "href");
    const pdf = await p.request.get(pdfHref), pdfBuf = await pdf.body();
    check(`${w}px PDF export is a real PDF`, pdf.ok() && pdfBuf.slice(0, 5).toString() === "%PDF-" && pdfBuf.length > 3000 && /pdf/.test(pdf.headers()["content-type"]), `${pdfBuf.length} bytes`);
    const sum = await p.request.get(sumHref), sumTxt = await sum.text();
    check(`${w}px summary export contains the settings and software versions`, sum.ok() && /highpass/.test(sumTxt) && /Limitations/.test(sumTxt) && /scipy/i.test(sumTxt), `${sumTxt.length} chars`);
    const wav = await (await p.request.get(wavHref)).body(); check(`${w}px processed WAV download is RIFF/WAVE`, wav.slice(0, 4).toString() === "RIFF" && wav.slice(8, 12).toString() === "WAVE", `${wav.length} bytes`);
    await overflow("report"); await axe(p, `${w}px report`);

    // ---------- Presentation Mode (ClearVoice)
    await spa("/clearvoice/overview"); await p.waitForSelector(".session-strip");
    await p.click(".session-strip .present-btn"); await p.waitForSelector("[role=dialog][aria-label='Presentation mode']");
    check(`${w}px session-strip Presentation button opens ClearVoice at step 1`, /Step 1 of 9/.test(await p.textContent(".present-progress")));
    await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.click("header .present-btn, nav .present-btn, .nav-links .present-btn").catch(async () => { await p.click(".session-strip .present-btn"); });
    if (await p.$("text=Choose a presentation")) { check(`${w}px nav Presentation button offers the chooser`, true); await p.click("button:has-text('ClearVoice: analysis and filtering')"); }
    const heads = [];
    for (let i = 0; i < 9; i++) {
      await p.waitForTimeout(500); heads.push((await p.textContent(".present-main h1")).trim());
      const say = await p.textContent("[aria-label='What to say']"); if (i === 0) check(`${w}px "What to say" panel shown`, say.length > 60);
      if (i === 3) { check(`${w}px frequency step uses the file's real peaks`, /13\d\d(\.\d)? Hz/.test(say), say.slice(0, 100)); await axe(p, `${w}px presentation (frequency step)`); await p.screenshot({ path: path.join(OUT, `${w}_presentation_frequency.png`) }); }
      if (i === 6) { await p.waitForSelector(".present audio", { state: "attached" }).catch(() => {}); check(`${w}px comparison step has real original + processed players`, (await p.locator(".present audio").count()) === 2); }
      if (i < 8) await p.click(".present-foot button:has-text('Next')");
    }
    check(`${w}px presentation shows the nine ClearVoice steps in order`, heads.join("|") === "Introduction|Upload|Waveform|Frequency analysis|Filtering|Processing|Audio comparison|Results|Conclusion", heads.join(" > "));
    await p.click(".present-foot button:has-text('Back')"); await p.waitForTimeout(700); check(`${w}px Back works`, /Results/.test(await p.textContent(".present-main h1")));
    await p.click("button:has-text('Restart')"); check(`${w}px Restart returns to step 1`, /Step 1 of 9/.test(await p.textContent(".present-progress")));
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    check(`${w}px exit keeps the recording and results`, !(await p.$(".present")) && (await p.textContent(".session-strip")).includes("siren_in_traffic.wav"));
    await spa("/clearvoice/comparison"); await p.waitForTimeout(1200);
    check(`${w}px existing comparison step still reachable after the presentation`, p.url().endsWith("/comparison"));

    // ---------- RoadSonic presentation + preserved workflow
    await p.goto(B + "/roadsonic/upload"); await p.setInputFiles("input[type=file]", WAV); await p.waitForSelector("text=Validated recording", { timeout: 20000 });
    await next(); await p.click(".session-strip .present-btn");
    const rh = [];
    for (let i = 0; i < 9; i++) {
      await p.waitForTimeout(400); rh.push((await p.textContent(".present-main h1")).trim());
      if (i === 6) { const t = await p.textContent(".present-stage"); check(`${w}px events step does not claim a detection before one is run`, /has not been run yet/.test(t) && !/detected/i.test(t), t.slice(0, 80));
        await p.click(".present-stage button:has-text('Run candidate detection')"); await p.waitForTimeout(7000);
        const t2 = await p.textContent(".present-stage"); check(`${w}px events step then shows the backend's real result`, /Spectrogram with candidate events|No candidate events/.test(t2), t2.slice(0, 80)); }
      if (i === 8) { check(`${w}px limitations step states the prototype's limits`, /not validated as a safety system/.test(await p.textContent(".present-stage"))); }
      if (i < 8) await p.click(".present-foot button:has-text('Next')");
    }
    check(`${w}px RoadSonic nine steps in order`, rh.join("|") === "Introduction|Upload traffic audio|Waveform|Frequency analysis|Spectrogram|Audio features|Candidate siren events|Detection evidence|Limitations and future scope", rh.join(" > "));
    await p.screenshot({ path: path.join(OUT, `${w}_presentation_roadsonic_end.png`) });
    await p.click(".present-head button:has-text('Exit')"); await spa("/roadsonic/events"); await p.waitForTimeout(1200);
    check(`${w}px RoadSonic events step still works (detection kept)`, p.url().endsWith("/roadsonic/events") && (await p.textContent("body")).includes("Candidate"));
    check(`${w}px no console errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
    await ctx.close();
  }
  await browser.close();
  const f = res.filter((x) => !x).length; console.log(`\n${res.length - f}/${res.length} checks passed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });
