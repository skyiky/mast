import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useConnectionStore } from "./stores/connection.js";
import { Layout } from "./pages/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PairPage } from "./pages/PairPage.js";
import { SessionListPage } from "./pages/SessionListPage.js";
import { ChatPage } from "./pages/ChatPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { ConfirmDaemonPage } from "./pages/ConfirmDaemonPage.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useHydration } from "./hooks/useHydration.js";
import { useAutoConnect } from "./hooks/useAutoConnect.js";
import { useSupabaseAuth } from "./hooks/useSupabaseAuth.js";

/** Persist the current URL so we can redirect back after OAuth. */
function savePendingRedirect(): void {
  try {
    const { pathname, search } = window.location;
    if (pathname.startsWith("/confirm-daemon") && search) {
      sessionStorage.setItem("mast:pendingRedirect", pathname + search);
    }
  } catch {
    // sessionStorage may be unavailable
  }
}

/**
 * After OAuth, the browser lands on "/" (the origin). This component checks
 * sessionStorage for a pending redirect (e.g. /confirm-daemon?code=...) and
 * navigates there. Runs once inside BrowserRouter after auth is confirmed.
 */
function PendingRedirectHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("mast:pendingRedirect");
      if (pending) {
        sessionStorage.removeItem("mast:pendingRedirect");
        navigate(pending, { replace: true });
      }
    } catch {
      // sessionStorage may be unavailable
    }
  }, [navigate]);
  return null;
}

export function App() {
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);
  const authReady = useConnectionStore((s) => s.authReady);
  const hydrated = useHydration();

  // Bridge Supabase auth state into connection store (hosted mode).
  // In local mode this is a no-op — useAutoConnect overwrites the token.
  useSupabaseAuth();

  // Auto-connect in local mode after hydration completes.
  useAutoConnect(hydrated);

  // Connect WebSocket when authenticated + paired
  useWebSocket();

  // Wait for persist rehydration + auth resolution before deciding which page.
  // Without the authReady check, LoginPage would flash briefly while Supabase
  // processes the OAuth redirect tokens from the URL hash.
  if (!hydrated || !authReady) return null;

  // Auth guard: no token → login (save confirm-daemon URL for post-OAuth redirect)
  if (!apiToken) {
    savePendingRedirect();
    return <LoginPage />;
  }
  if (!paired) return <PairPage />;

  return (
    <BrowserRouter>
      <PendingRedirectHandler />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SessionListPage />} />
          <Route path="chat/:id" element={<ChatPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="confirm-daemon" element={<ConfirmDaemonPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
