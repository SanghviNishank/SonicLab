import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./pages/HomePage";
import { Info } from "./pages/Info";
import { PageSkeleton } from "./components/ui";

const ClearVoiceRoutes = lazy(() => import("./pages/clearvoice/ClearVoiceRoutes"));
const LearnPage = lazy(() => import("./pages/LearnPage"));
const RoadSonicRoutes = lazy(() => import("./pages/roadsonic/RoadSonicRoutes"));

export default function App() {
  return (
    <Suspense fallback={<div className="page"><PageSkeleton /></div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="learn" element={<LearnPage />} />
          <Route path="how-it-works" element={<Info kind="how" />} />
          <Route path="docs" element={<Info kind="docs" />} />
          <Route path="clearvoice" element={<Navigate to="/clearvoice/upload" replace />} />
          <Route path="clearvoice/*" element={<ClearVoiceRoutes />} />
          <Route path="roadsonic" element={<Navigate to="/roadsonic/upload" replace />} />
          <Route path="roadsonic/*" element={<RoadSonicRoutes />} />
          <Route path="*" element={<div className="page"><div className="empty"><h2>Page not found</h2><p className="muted">That address does not exist in SonicSense.</p></div></div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
