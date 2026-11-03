import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import ModeToggle from "../components/ui/ModeToggle";
import { useSession } from "../context/Session";
import { useLearningMode } from "../hooks/useLearningMode";
import { buildFacts } from "../logic/learnFacts.ts";
import { LESSONS } from "../features/learn/lessons";
import { RealFilterExperiment, RealSpectrogramExperiment, RealSpectrumExperiment, SamplingExperiment, SineExperiment } from "../features/learn/Experiments";

export default function LearnPage() {
  const { cv, rs } = useSession(), [mode] = useLearningMode(), [id, setId] = useState(LESSONS[0].id);
  const facts = useMemo(() => buildFacts(cv, rs), [cv, rs]);
  const lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0], mine = lesson.yours(facts);
  const exp = { sine: <SineExperiment />, sampling: <SamplingExperiment />, fft: <RealSpectrumExperiment cv={cv} rs={rs} />, filter: <RealFilterExperiment cv={cv} />, spectrogram: <RealSpectrogramExperiment cv={cv} />, none: null }[lesson.experiment ?? "none"];
  return (
    <div className="page stack">
      <div className="row"><GraduationCap aria-hidden="true" /><h1 style={{ margin: 0 }}>DSP Learning Assistant</h1><span style={{ marginLeft: "auto" }}><ModeToggle /></span></div>
      <p className="muted">Learn signal processing with your own recording. Sentences marked <b>Your recording</b> use measurements from the file you uploaded; experiments marked synthetic use generated demo signals.
        {facts.source ? <> Using <b>{facts.fileName ?? "your recording"}</b> ({facts.source === "clearvoice" ? "ClearVoice" : "RoadSonic"}).</> : <> No recording is loaded: <Link to="/clearvoice/upload">upload one</Link> to see your own values.</>}</p>
      <div className="learn-layout">
        <nav aria-label="Lessons"><ol className="lesson-list">{LESSONS.map((l, i) => <li key={l.id}><button aria-current={l.id === id ? "true" : undefined} onClick={() => setId(l.id)}><span className="mono muted">{String(i + 1).padStart(2, "0")}</span> {l.title}</button></li>)}</ol></nav>
        <article className="stack" aria-labelledby="lesson-h">
          <h2 id="lesson-h">{lesson.title}</h2>
          <section className="card stack">{(mode === "beginner" ? lesson.beginner : lesson.technical).map((p, i) => <p key={i} className={mode === "technical" ? "eq-text" : ""}>{p}</p>)}</section>
          <section className="card yours" aria-label="Your recording"><h3>Your recording</h3>{mine ? <p>{mine}</p> : <p className="muted">{facts.source ? "This measurement is not available yet for your recording. Run the related analysis step first." : "Upload a recording to see this explained with your own measurements."}</p>}</section>
          <section className="card"><h3>Why does this matter?</h3><p>{lesson.why}</p></section>
          {exp && <section className="card stack" aria-label="Interactive experiment"><h3>Try it</h3>{exp}</section>}
          <div className="actions"><button className="btn ghost" disabled={LESSONS[0].id === id} onClick={() => setId(LESSONS[Math.max(0, LESSONS.indexOf(lesson) - 1)].id)}>Previous lesson</button>
            <button className="btn" disabled={LESSONS[LESSONS.length - 1].id === id} onClick={() => setId(LESSONS[Math.min(LESSONS.length - 1, LESSONS.indexOf(lesson) + 1)].id)}>Next lesson</button></div>
        </article>
      </div>
    </div>
  );
}
