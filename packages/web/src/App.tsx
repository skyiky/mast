import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useConnectionStore } from "./stores/connection.js";
import { Layout } from "./pages/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PairPage } from "./pages/PairPage.js";
import { SessionsPage } from "./pages/SessionsPage.js";
import { ChatPage } from "./pages/ChatPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { detectLocalMode } from "./lib/local-mode.js";

export function App() {
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);

  // Auto-connect in local mode (served from localhost)
  useEffect(() => {
    const store = useConnectionStore.getState();
    // Only auto-connect if not already configured
    if (store.apiToken) return;

    const result = detectLocalMode(window.location.origin);
    if (result.isLocal) {
      store.setServerUrl(result.serverUrl);
      store.setApiToken(result.apiToken);
      store.setAuthReady(true);
      store.setPaired(true);
    }
  }, []);

  // Connect WebSocket when authenticated + paired
  useWebSocket();

  // Auth guard: no token → login, no pairing → pair
  if (!apiToken) return <LoginPage />;
  if (!paired) return <PairPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SessionsPage />} />
          <Route path="chat/:id" element={<ChatPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
