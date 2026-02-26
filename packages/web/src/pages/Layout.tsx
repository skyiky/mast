/**
 * Layout — sidebar with project navigation + main content area.
 *
 * The sidebar contains:
 * - Header: "mast" logo + settings gear
 * - Project nav: tab per project (like Claude's Chats/Projects/Artifacts/Code)
 * - Starred: pinned session titles
 * - Footer: compact connection status
 *
 * The main panel shows either the session list or a chat view.
 * On mobile (< 768px), the sidebar becomes a slide-out overlay.
 */

import { useState, useCallback, useMemo } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ConnectionStatus } from "../components/ConnectionStatus.js";
import { SidebarProjectNav } from "../components/SidebarProjectNav.js";
import { SidebarStarred } from "../components/SidebarStarred.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { useSessions } from "../hooks/useSessions.js";
import { useProjects } from "../hooks/useProjects.js";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { useSessionStore } from "../stores/sessions.js";
import "../styles/layout.css";

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const { sessions } = useSessions();
  const { projects, loading: loadingProjects } = useProjects();
  const starredSessionIds = useSessionStore((s) => s.starredSessionIds);
  const toggleStarred = useSessionStore((s) => s.toggleStarred);
  const selectedProject = useSessionStore((s) => s.selectedProject);
  const setSelectedProject = useSessionStore((s) => s.setSelectedProject);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const starredSet = useMemo(() => new Set(starredSessionIds), [starredSessionIds]);

  // Global keyboard shortcuts
  useKeyboardShortcuts();

  const handleSelectSession = useCallback((sessionId: string) => {
    navigate(`/chat/${sessionId}`);
    setSidebarOpen(false);
  }, [navigate]);

  const handleSelectProject = useCallback((project: string | null) => {
    setSelectedProject(project);
    // Navigate to session list when switching projects
    if (location.pathname !== "/") {
      navigate("/");
    }
    setSidebarOpen(false);
  }, [setSelectedProject, navigate, location.pathname]);

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

        {/* Project navigation */}
        <SidebarProjectNav
          projects={projects}
          loading={loadingProjects}
          selectedProject={selectedProject}
          onSelect={handleSelectProject}
        />

        {/* Starred sessions */}
        <SidebarStarred
          sessions={sessions}
          starredIds={starredSet}
          activeSessionId={activeSessionId}
          onSelect={handleSelectSession}
          onToggleStar={toggleStarred}
        />

        {/* Spacer to push connection status to bottom */}
        <div style={{ flex: 1 }} />

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
