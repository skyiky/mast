/**
 * SidebarSessionList — session list for the sidebar.
 * Groups sessions by status: Starred, Idle, Archived.
 * Each row shows title + project path (like Claude's Remote Control UI).
 */

import { memo, useCallback } from "react";
import type { Session } from "../lib/types.js";
import { groupSessionsByStatus, formatProjectPath } from "../lib/sessions-utils.js";

interface SidebarSessionListProps {
  sessions: Session[];
  loading: boolean;
  activeSessionId: string | null;
  starredIds: Set<string>;
  onSelect: (sessionId: string) => void;
  onToggleStar: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
}

function SidebarSessionListInner({
  sessions,
  loading,
  activeSessionId,
  starredIds,
  onSelect,
  onToggleStar,
  onDelete,
  onNewSession,
}: SidebarSessionListProps) {
  if (loading && sessions.length === 0) {
    return <div className="sidebar-sessions-empty">Loading...</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="sidebar-sessions-empty">
        <p>No sessions yet</p>
        <button className="sidebar-new-session-btn" onClick={onNewSession}>
          New session
        </button>
      </div>
    );
  }

  const groups = groupSessionsByStatus(sessions, starredIds);

  return (
    <div className="sidebar-sessions">
      {groups.map((group) => (
        <div key={group.dateKey} className="sidebar-session-group">
          <div className="sidebar-group-label">{group.label}</div>
          {group.sessions.map((session) => (
            <SidebarSessionRow
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              starred={starredIds.has(session.id)}
              onSelect={onSelect}
              onToggleStar={onToggleStar}
              onDelete={onDelete}
            />
          ))}
        </div>
      ))}

      {/* Bottom "New session" button */}
      <div className="sidebar-new-session-area">
        <button className="sidebar-new-session-btn" onClick={onNewSession}>
          New session
        </button>
      </div>
    </div>
  );
}

export const SidebarSessionList = memo(SidebarSessionListInner);
SidebarSessionList.displayName = "SidebarSessionList";

// ---------------------------------------------------------------------------
// SidebarSessionRow
// ---------------------------------------------------------------------------

interface SidebarSessionRowProps {
  session: Session;
  active: boolean;
  starred: boolean;
  onSelect: (sessionId: string) => void;
  onToggleStar: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

function SidebarSessionRowInner({
  session,
  active,
  starred,
  onSelect,
  onToggleStar,
  onDelete,
}: SidebarSessionRowProps) {
  const projectPath = formatProjectPath(session);

  const handleStar = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleStar(session.id);
    },
    [onToggleStar, session.id],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(session.id);
    },
    [onDelete, session.id],
  );

  return (
    <button
      className={`sidebar-session-row ${active ? "active" : ""}`}
      onClick={() => onSelect(session.id)}
      title={session.title || session.id}
    >
      {/* Left: star + text block */}
      <span
        className={`sidebar-session-star ${starred ? "starred" : ""}`}
        onClick={handleStar}
        title={starred ? "Unstar" : "Star"}
      >
        {starred ? "\u2605" : "\u2606"}
      </span>

      <span className="sidebar-session-info">
        <span className="sidebar-session-title">
          {session.title || `${session.id.slice(0, 12)}...`}
        </span>
        {projectPath && (
          <span className="sidebar-session-project">{projectPath}</span>
        )}
      </span>

      {/* Right: actions + chevron */}
      <span
        className="sidebar-session-delete"
        onClick={handleDelete}
        title="Remove session"
      >
        &times;
      </span>
      <span className="sidebar-session-chevron">{"\u203A"}</span>
    </button>
  );
}

const SidebarSessionRow = memo(SidebarSessionRowInner);
SidebarSessionRow.displayName = "SidebarSessionRow";
