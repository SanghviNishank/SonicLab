import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilterResponseChart } from "../../components/charts";
import ModeToggle from "../../components/ui/ModeToggle";
import { ErrorPanel, ProcessingStatus } from "../../components/ui";
import { useSession } from "../../context/Session";
import { isAborted, postJson } from "../../api";
import { useLearningMode } from "../../hooks/useLearningMode";
import { classifyResponse } from "../../logic/filterRegions.ts";
import { MAX_ORDER, MIN_ORDER } from "../../logic/filterValidation.ts";
import { DEFAULT_LAB, LAB_TYPES, hzToSlider, maxResponseDifferenceDb, retainedSummary, sliderToHz, toBackend, validateLab, type LabState } from "../../logic/filterLab.ts";

function FreqControl({ label, value, fs, onChange, id }: { label: string; value: number; fs: number; onChange: (hz: number) => void; id: string }) {
  return (
    <div className="freq-ctl"><label htmlFor={id + "-n"}>{label}</label>
      <div className="row"><input id={id + "-s"} type="range" aria-label={`${label} slider (logarithmic)`} min={0} max={1000} value={hzToSlider(value, fs)} onChange={(e) => onChange(sliderToHz(Number(e.target.value), fs))} />
        <input id={id + "-n"} type="number" min={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} in hertz`} /> <span className="muted">Hz</span></div></div>
  );
}

/** Visual Filter Lab: a theoretical response from the backend's own filter design (POST .../filter/preview) that updates as you move the controls,
 *  and "Apply Filter" which runs the same design on the real recording. Nothing is designed or filtered in the browser. */
export default function VisualFilterLab({ fs, id }: { fs: number; id: string }) {
  const { cv, patchCv } = useSession(), nav = useNavigate(), [mode] = useLearningMode();
  const [s, setS] = useState<LabState>(DEFAULT_LAB), [preview, setPreview] = useState<any>(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [pErr, setPErr] = useState("");
  const errors = validateLab(s, fs), req = toBackend(s), key = JSON.stringify({ k: "filter", ...req, ui: s.type });
  const applied = cv.filter?.kind === "filter" ? cv.filter : null, stale = applied?.requestKey !== key;
  useEffect(() => {
    setPErr(""); if (errors.length) { setPreview(null); return; }
    const ctl = new AbortController();                                      // a newer slider position cancels the older request
    const t = setTimeout(() => postJson(`/api/v1/clearvoice/${id}/filter/preview`, { filter_type: req.filter_type, order: req.order, cutoff_hz: req.cutoff_hz, method: req.method }, ctl.signal)
      .then((p) => { setPreview({ ...p, forKey: key }); }).catch((e) => { if (!isAborted(e)) { setPreview(null); setPErr(e.message); } }), 120);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key]);                                                                // eslint-disable-line react-hooks/exhaustive-deps
  const regions = useMemo(() => (preview ? classifyResponse(preview.response.freqs_hz, preview.response.magnitude_db, req.method === "zero_phase" ? -6 : -3, -40) : []), [preview]);   // eslint-disable-line react-hooks/exhaustive-deps
  const sum = retainedSummary(regions);
  const set = (p: Partial<LabState>) => setS((o) => ({ ...o, ...p }));
  const two = s.type === "bandpass" || s.type === "bandstop";
  const label = s.type === "notch" ? `notch (narrow band-stop) ${req.cutoff_hz.map((c) => Math.round(c)).join("–")} Hz, order ${req.order}, ${req.method}` : `${s.type} ${req.cutoff_hz.join("–")} Hz, order ${req.order}, ${req.method}`;
  async function apply() {
    if (errors.length) return; setBusy(true); setErr("");
    try { const result = await postJson(`/api/v1/clearvoice/${id}/filter`, { filter_type: req.filter_type, order: req.order, cutoff_hz: req.cutoff_hz, method: req.method });
      patchCv({ filter: { kind: "filter", requestKey: key, label, result, previewResponse: preview?.forKey === key ? preview.response : null } }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const diff = applied && !stale && applied.previewResponse && applied.result?.response ? maxResponseDifferenceDb(applied.previewResponse, applied.result.response) : null;

  return (
    <div className="layout-split">
      <div className="stack">
        <section className="card"><div className="row"><h3 style={{ margin: 0 }}>Visual Filter Lab</h3><span style={{ marginLeft: "auto" }}><ModeToggle /></span></div>
          <p className="callout">Think of a filter as a gate for sound frequencies. Some frequencies are allowed through, while others are reduced.</p></section>
        <div className="filter-cards" role="radiogroup" aria-label="Filter type">
          {LAB_TYPES.map((t) => <button key={t.type} role="radio" aria-checked={s.type === t.type} className={"filter-card" + (s.type === t.type ? " on" : "")} onClick={() => set({ type: t.type })}><b>{t.name}</b><span className="muted">{t.blurb}</span></button>)}
        </div>
        {preview && !errors.length ? <FilterResponseChart response={preview.response} cutoffs={req.cutoff_hz} fs={fs} /> : <section className="card"><p className="muted" role="status">{errors.length ? "Fix the settings to see the response." : pErr ? "" : "Designing filter…"}</p>{pErr && <p className="error" role="alert">{pErr}</p>}</section>}
        {preview && <section className="card stack" aria-label="What is kept and reduced">
          <div className="keep-reduce"><div className="kept"><b>Retained</b><span>{sum.kept}</span></div><div className="reduced"><b>Reduced</b><span>{sum.reduced}</span></div></div>
          <p className="muted">Green = passband (kept within {req.method === "zero_phase" ? "6" : "3"} dB), amber = transition (partly reduced), red = stopband (reduced by 40 dB or more). Measured from the designed response.</p>
          <p>{preview.attenuation_at_cutoff.map((a: any) => `${a.frequency_hz.toFixed(0)} Hz: ${a.magnitude_db.toFixed(2)} dB`).join(" · ")} <span className="muted">at the cutoff</span></p>
          {mode === "technical" ? <div className="muted stack">
            <p><b>Butterworth filter.</b> Magnitude |H(f)|² = 1 / (1 + (f/f<sub>c</sub>)<sup>2n</sup>): maximally flat in the passband, no ripple.</p>
            <p><b>Cutoff frequency f<sub>c</sub></b> is the −3 dB point of a single pass. <b>Order n</b> = {req.order}: the slope in the transition band approaches about {6 * req.order} dB per octave; a higher order is steeper but rings more.</p>
            <p><b>Magnitude response</b> {req.method === "zero_phase" ? "is squared by forward-backward filtering (−6 dB at f_c)." : "is for one causal pass (−3 dB at f_c)."} <b>Phase:</b> {req.method === "zero_phase" ? "exactly zero, but the filter is noncausal (uses future samples)." : "non-zero; different frequencies are delayed by different amounts (group delay)."}</p>
            <p>Designed as second-order sections (SOS) for numerical stability. Normalised cutoff = {req.cutoff_hz.map((c) => (c / (fs / 2)).toFixed(4)).join(", ")} (Nyquist = {fs / 2} Hz).{s.type === "notch" ? " A notch here is a narrow Butterworth band-stop centred on the chosen frequency." : ""}</p></div>
            : <p className="muted">Frequencies in the green zone keep their strength. Frequencies in the red zone are turned down a lot. The amber zone is the gradual slope between them. A higher order makes the slope steeper.</p>}
        </section>}
      </div>
      <aside className="card stack" aria-label="Filter settings"><h3>Filter settings</h3>
        <label>Filter type<select value={s.type} onChange={(e) => set({ type: e.target.value as any })}>{LAB_TYPES.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}</select></label>
        {s.type === "notch" ? <>
          <FreqControl id="notch-c" label="Notch centre frequency" value={s.centre} fs={fs} onChange={(hz) => set({ centre: hz })} />
          <label>Notch width (Hz)<input type="number" min={1} value={s.bandwidth} onChange={(e) => set({ bandwidth: Number(e.target.value) })} /></label></>
          : <>
          <FreqControl id="f1" label={two ? "Lower cutoff" : "Cutoff frequency"} value={s.f1} fs={fs} onChange={(hz) => set({ f1: hz })} />
          {two && <FreqControl id="f2" label="Upper cutoff" value={s.f2} fs={fs} onChange={(hz) => set({ f2: hz })} />}</>}
        <label>Filter order ({MIN_ORDER}–{MAX_ORDER})<select value={s.order} onChange={(e) => set({ order: Number(e.target.value) })}>{Array.from({ length: MAX_ORDER }, (_, i) => i + 1).map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={s.zeroPhase} onChange={(e) => set({ zeroPhase: e.target.checked })} /> Zero-phase filtering (forward-backward)</label>
        <p className="muted mono">Nyquist = {fs / 2} Hz{!errors.length && ` · normalized cutoff = ${req.cutoff_hz.map((c) => (c / (fs / 2)).toFixed(4)).join(", ")}`}</p>
        {errors.length > 0 && <ul className="error" role="alert">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <button className="btn" disabled={busy || errors.length > 0} onClick={apply}>{busy ? "Applying…" : applied && !stale ? "Re-apply filter" : "Apply Filter"}</button>
        {busy && <ProcessingStatus label="Filtering every channel of the original samples…" />}{err && <ErrorPanel message={err} />}
        {applied && <div className="stack" aria-label="Applied filter settings">
          <p className={"chip " + (stale ? "warn" : "ok")} role="status">{stale ? "● Settings changed - apply again" : "✓ Applied to your recording"}</p>
          <dl className="meta-grid"><div><dt>Applied filter</dt><dd>{applied.label}</dd></div><div><dt>Type</dt><dd>{applied.result.config.filter_type}</dd></div><div><dt>Cutoff (Hz)</dt><dd>{applied.result.config.cutoff_hz.join(", ")}</dd></div>
            <div><dt>Order</dt><dd>{applied.result.config.order}</dd></div><div><dt>Method</dt><dd>{applied.result.config.method}</dd></div></dl>
          {diff !== null && <p className="muted" role="status">Preview vs applied response: largest difference {diff.toFixed(3)} dB. {diff < 0.1 ? "✓ consistent" : "⚠ differs"}</p>}
          <button className="btn ghost" onClick={() => nav("/clearvoice/comparison")}>Open Before vs After Studio</button></div>}
      </aside>
    </div>
  );
}
