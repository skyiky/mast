/**
 * SidebarProjectNav — project navigation tabs for the sidebar.
 * Shows "All" + one tab per project, matching Claude's Remote Control UI.
 */

import { memo } from "react";
import type { Project } from "../lib/api.js";

interface SidebarProjectNavProps {
  projects: Project[];
  loading: boolean;
  selectedProject: string | null;
  onSelect: (project: string | null) => void;
}

function SidebarProjectNavInner({
  projects,
  loading,
  selectedProject,
  onSelect,
}: SidebarProjectNavProps) {
  return (
    <nav className="sidebar-nav">
      <button
        className={`sidebar-nav-tab ${selectedProject === null ? "active" : ""}`}
        onClick={() => onSelect(null)}
      >
        <span className="sidebar-nav-icon">{"\u2302"}</span>
        All
      </button>

      {projects.map((p) => (
        <button
          key={p.name}
          className={`sidebar-nav-tab ${selectedProject === p.name ? "active" : ""}`}
          onClick={() => onSelect(p.name)}
          title={p.directory}
        >
          <span className="sidebar-nav-icon">{"\u2329\u232A"}</span>
          {p.name}
        </button>
      ))}

      {loading && projects.length === 0 && (
        <div className="sidebar-nav-loading">Loading...</div>
      )}
    </nav>
  );
}

export const SidebarProjectNav = memo(SidebarProjectNavInner);
SidebarProjectNav.displayName = "SidebarProjectNav";
