/**
 * SidebarSessionList — compact session list for the sidebar.
 * Shows sessions grouped by day with activity dots and time-ago labels.
 */

import { memo } from "react";
import type { Session } from "../lib/types.js";
import { getTimeAgo, groupSessionsByDay } from "../lib/sessions-utils.js";

interface SidebarSessionListProps {
  sessions: Session[];
  loading: boolean;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

function SidebarSessionListInner({
  sessions,
  loading,
  activeSessionId,
  onSelect,
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

  const groups = groupSessionsByDay(sessions);

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
              onSelect={onSelect}
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
  onSelect: (sessionId: string) => void;
}

function SidebarSessionRowInner({ session, active, onSelect }: SidebarSessionRowProps) {
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

  return (
    <button
      className={`sidebar-session-row ${active ? "active" : ""}`}
      onClick={() => onSelect(session.id)}
      title={session.title || session.id}
    >
      <span className={`sidebar-session-dot ${session.hasActivity ? "has-activity" : ""}`}>
        {session.hasActivity ? "\u25CF" : "\u25CB"}
      </span>
      <span className="sidebar-session-title">
        {session.title || `${session.id.slice(0, 12)}...`}
      </span>
      <span className="sidebar-session-time">{timeAgo}</span>
    </button>
  );
}

const SidebarSessionRow = memo(SidebarSessionRowInner);
SidebarSessionRow.displayName = "SidebarSessionRow";
