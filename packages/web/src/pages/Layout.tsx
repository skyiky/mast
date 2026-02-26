import { Outlet, Link, useLocation } from "react-router-dom";
import { ConnectionBanner } from "../components/ConnectionBanner.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import "../styles/layout.css";

export function Layout() {
  const location = useLocation();

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="sidebar-header">
          <Link to="/" className="logo">mast</Link>
          <Link
            to="/settings"
            className={`nav-link${location.pathname === "/settings" ? " active" : ""}`}
            title="Settings"
          >
            settings
          </Link>
        </div>
        <ConnectionBanner />
        {/* Session list rendered inline on desktop via SessionsPage */}
      </nav>
      <main className="main-content">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
