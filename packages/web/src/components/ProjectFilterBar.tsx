/**
 * ProjectFilterBar — horizontal filter pills for multi-project sessions.
 * Shows "all" + one pill per unique project. Only renders when 2+ projects exist.
 */

import { memo } from "react";

interface ProjectFilterBarProps {
  projects: string[];
  selected: string | null; // null = "all"
  onSelect: (project: string | null) => void;
}

function ProjectFilterBarInner({
  projects,
  selected,
  onSelect,
}: ProjectFilterBarProps) {
  // Don't render if only one project — no filtering needed
  if (projects.length < 2) return null;

  return (
    <div className="project-filter-bar">
      <button
        className={`filter-chip ${selected === null ? "active" : ""}`}
        onClick={() => onSelect(null)}
      >
        all
      </button>
      {projects.map((name) => (
        <button
          key={name}
          className={`filter-chip ${selected === name ? "active" : ""}`}
          onClick={() => onSelect(name)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export const ProjectFilterBar = memo(ProjectFilterBarInner);
ProjectFilterBar.displayName = "ProjectFilterBar";
