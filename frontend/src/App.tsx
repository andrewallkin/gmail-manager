import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Status, fetchStatus } from "./lib/api";
import { CleanupPage } from "./pages/CleanupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AIPage } from "./pages/AIPage";
import { LabelsPage } from "./pages/LabelsPage";
import { Login } from "./pages/Login";
import { RestorePage } from "./pages/RestorePage";
import { RulesPage } from "./pages/RulesPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const [status, setStatus] = useState<Status | null | "loading">("loading");

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchStatus();
      setStatus(s ?? null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30_000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!status?.connected) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout status={status} onLogout={() => setStatus(null)} />}>
          <Route index element={<DashboardPage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="cleanup" element={<CleanupPage />} />
          <Route path="restore" element={<RestorePage />} />
          <Route
            path="ai"
            element={<AIPage status={status} onStatusChange={setStatus} />}
          />
          <Route
            path="settings"
            element={<SettingsPage status={status} onStatusChange={setStatus} />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
