import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { CommunityAuthProvider } from "./lib/community/auth";
import "./styles.css";

const App = lazy(() => import("./App"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage").then((mod) => ({ default: mod.AuthCallbackPage })));
const CommunityPage = lazy(() => import("./pages/CommunityPage").then((mod) => ({ default: mod.CommunityPage })));

// The reader Brief is the default experience. `?reviewer` (alias `?workbench`)
// opens the extraction/QA workbench for human review.
function HomeRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.has("reviewer") || params.has("workbench")) {
    return <Navigate to="/reviewer" replace />;
  }
  return <CommunityPage initialTab="brief" />;
}

function ThreadRoute() {
  const { threadId } = useParams();
  return <CommunityPage initialTab="forum" initialThreadId={threadId} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <CommunityAuthProvider>
        <Suspense fallback={<main className="route-loading">Loading...</main>}>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/reviewer" element={<App />} />
            <Route path="/forums" element={<CommunityPage initialTab="forum" />} />
            <Route path="/forums/thread/:threadId" element={<ThreadRoute />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </CommunityAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
