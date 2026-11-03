import { useLearningMode } from "../../hooks/useLearningMode";

export default function ModeToggle() {
  const [mode, set] = useLearningMode();
  return (
    <div className="ab" role="group" aria-label="Explanation level">
      <button aria-pressed={mode === "beginner"} onClick={() => set("beginner")}>Beginner</button>
      <button aria-pressed={mode === "technical"} onClick={() => set("technical")}>Technical</button>
    </div>
  );
}
