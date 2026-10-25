import { Navigate, Route, Routes } from "react-router-dom";
import { StepGuard } from "../../components/workflow/WorkflowShell";
import { UploadStep, OverviewStep } from "./Steps1";
import { PreprocessStep, FeaturesStep } from "./Steps2";
import { DetectStep, EventsStep } from "./Steps3";
import { ReviewStep, SummaryStep } from "./Steps4";

const g = (step: string, el: JSX.Element) => <Route path={step} element={<StepGuard module="roadsonic" step={step}>{el}</StepGuard>} />;
export default function RoadSonicRoutes() {
  return (
    <Routes>
      {g("upload", <UploadStep />)}{g("overview", <OverviewStep />)}{g("preprocess", <PreprocessStep />)}{g("features", <FeaturesStep />)}
      {g("detect", <DetectStep />)}{g("events", <EventsStep />)}{g("review", <ReviewStep />)}{g("summary", <SummaryStep />)}
      <Route path="*" element={<Navigate to="/roadsonic/upload" replace />} />
    </Routes>
  );
}
