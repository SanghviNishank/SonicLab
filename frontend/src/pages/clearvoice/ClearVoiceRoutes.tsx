import { Navigate, Route, Routes } from "react-router-dom";
import { StepGuard } from "../../components/workflow/WorkflowShell";
import UploadStep from "./UploadStep";
import OverviewStep from "./OverviewStep";
import TimeStep from "./TimeStep";
import FrequencyStep from "./FrequencyStep";
import SpectrogramStep from "./SpectrogramStep";
import FilterStep from "./FilterStep";
import ComparisonStep from "./ComparisonStep";
import ResultsStep from "./ResultsStep";

const g = (step: string, el: JSX.Element) => <Route path={step} element={<StepGuard module="clearvoice" step={step}>{el}</StepGuard>} />;
export default function ClearVoiceRoutes() {
  return (
    <Routes>
      {g("upload", <UploadStep />)}{g("overview", <OverviewStep />)}{g("time-analysis", <TimeStep />)}{g("frequency-analysis", <FrequencyStep />)}
      {g("spectrogram", <SpectrogramStep />)}{g("filter", <FilterStep />)}{g("comparison", <ComparisonStep />)}{g("results", <ResultsStep />)}
      <Route path="*" element={<Navigate to="/clearvoice/upload" replace />} />
    </Routes>
  );
}
