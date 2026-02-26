/**
 * SidebarStarred — starred/pinned session list in the sidebar.
 * Shows single-line session titles that navigate to the chat view.
 */

import { memo, useCallback } from "react";
import type { Session } from "../lib/types.js";

interface SidebarStarredProps {
  sessions: Session[];
  starredIds: Set<string>;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onToggleStar: (sessionId: string) => void;
}

function SidebarStarredInner({
  sessions,
  starredIds,
  activeSessionId,
  onSelect,
  onToggleStar,
}: SidebarStarredProps) {
  const starred = sessions.filter((s) => starredIds.has(s.id));

  if (starred.length === 0) return null;

  return (
    <div className="sidebar-starred">
      <div className="sidebar-starred-label">Starred</div>
      {starred.map((s) => (
        <StarredItem
          key={s.id}
          session={s}
          active={s.id === activeSessionId}
          onSelect={onSelect}
          onToggleStar={onToggleStar}
        />
      ))}
    </div>
  );
}

export const SidebarStarred = memo(SidebarStarredInner);
SidebarStarred.displayName = "SidebarStarred";

// ---------------------------------------------------------------------------

interface StarredItemProps {
  session: Session;
  active: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
}

function StarredItemInner({ session, active, onSelect, onToggleStar }: StarredItemProps) {
  const handleUnstar = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleStar(session.id);
    },
    [onToggleStar, session.id],
  );

  return (
    <button
      className={`sidebar-starred-item ${active ? "active" : ""}`}
      onClick={() => onSelect(session.id)}
      title={session.title || session.id}
    >
      <span className="sidebar-starred-title">
        {session.title || `${session.id.slice(0, 12)}...`}
      </span>
      <span
        className="sidebar-starred-unpin"
        onClick={handleUnstar}
        title="Unstar"
      >
        {"\u{1F4CC}"}
      </span>
    </button>
  );
}

const StarredItem = memo(StarredItemInner);
StarredItem.displayName = "StarredItem";
