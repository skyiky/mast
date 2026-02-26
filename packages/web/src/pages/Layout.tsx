/**
 * Layout — sidebar with session list + main content area.
 *
 * The sidebar contains:
 * - Header: "mast" logo + settings gear + new session button
 * - Session list: grouped by day, scrollable
 * - Footer: compact connection status
 *
 * On mobile (< 768px), the sidebar becomes a slide-out overlay.
 */

import { useState, useCallback } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ConnectionStatus } from "../components/ConnectionStatus.js";
import { SidebarSessionList } from "../components/SidebarSessionList.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { useSessions } from "../hooks/useSessions.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import "../styles/layout.css";

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const { sessions, loadingSessions, createSession } = useSessions();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global keyboard shortcuts
  useKeyboardShortcuts();

  const handleNewSession = useCallback(async () => {
    const id = await createSession();
    if (id) {
      navigate(`/chat/${id}`);
      setSidebarOpen(false);
    }
  }, [createSession, navigate]);

  const handleSelectSession = useCallback((sessionId: string) => {
    navigate(`/chat/${sessionId}`);
    setSidebarOpen(false);
  }, [navigate]);

  const activeSessionId = params.id ?? (
    location.pathname.startsWith("/chat/")
      ? location.pathname.split("/chat/")[1]
      : null
  );

  return (
    <div className="layout">
      {/* Mobile hamburger button */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <nav className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        {/* Header */}
        <div className="sidebar-header">
          <Link to="/" className="logo" onClick={() => setSidebarOpen(false)}>
            mast
          </Link>
          <div className="sidebar-header-actions">
            <button
              className="sidebar-new-btn"
              onClick={handleNewSession}
              title="New session"
            >
              +
            </button>
            <Link
              to="/settings"
              className={`sidebar-settings-link${location.pathname === "/settings" ? " active" : ""}`}
              title="Settings"
              onClick={() => setSidebarOpen(false)}
            >
              {"\u2699"}
            </Link>
          </div>
        </div>

        {/* Session list */}
        <SidebarSessionList
          sessions={sessions}
          loading={loadingSessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelectSession}
        />

        {/* Footer: connection status */}
        <ConnectionStatus />
      </nav>

      <main className="main-content">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
