import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useConnectionStore } from "./stores/connection.js";
import { Layout } from "./pages/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PairPage } from "./pages/PairPage.js";
import { HomePage } from "./pages/HomePage.js";
import { ChatPage } from "./pages/ChatPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useHydration } from "./hooks/useHydration.js";
import { useAutoConnect } from "./hooks/useAutoConnect.js";

export function App() {
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);
  const hydrated = useHydration();

  // Auto-connect in local mode after hydration completes.
  useAutoConnect(hydrated);

  // Connect WebSocket when authenticated + paired
  useWebSocket();

  // Wait for persist rehydration + auto-connect before deciding which page to show.
  if (!hydrated) return null;

  // Auth guard: no token → login, no pairing → pair
  if (!apiToken) return <LoginPage />;
  if (!paired) return <PairPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="chat/:id" element={<ChatPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
