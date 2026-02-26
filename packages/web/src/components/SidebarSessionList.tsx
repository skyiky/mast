/**
 * SidebarSessionList — compact session list for the sidebar.
 * Groups sessions by status: Starred, Idle, Archived.
 * Supports star/unstar and delete actions on each row.
 */

import { memo, useCallback } from "react";
import type { Session } from "../lib/types.js";
import { getTimeAgo, groupSessionsByStatus } from "../lib/sessions-utils.js";

interface SidebarSessionListProps {
  sessions: Session[];
  loading: boolean;
  activeSessionId: string | null;
  starredIds: Set<string>;
  onSelect: (sessionId: string) => void;
  onToggleStar: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

function SidebarSessionListInner({
  sessions,
  loading,
  activeSessionId,
  starredIds,
  onSelect,
  onToggleStar,
  onDelete,
}: SidebarSessionListProps) {
  if (loading && sessions.length === 0) {
    return <div className="sidebar-sessions-empty">Loading...</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="sidebar-sessions-empty">
        No sessions yet
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
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

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
      <span
        className={`sidebar-session-star ${starred ? "starred" : ""}`}
        onClick={handleStar}
        title={starred ? "Unstar" : "Star"}
      >
        {starred ? "\u2605" : "\u2606"}
      </span>
      <span className="sidebar-session-title">
        {session.title || `${session.id.slice(0, 12)}...`}
      </span>
      <span className="sidebar-session-time">{timeAgo}</span>
      <span
        className="sidebar-session-delete"
        onClick={handleDelete}
        title="Remove session"
      >
        &times;
      </span>
    </button>
  );
}

const SidebarSessionRow = memo(SidebarSessionRowInner);
SidebarSessionRow.displayName = "SidebarSessionRow";
