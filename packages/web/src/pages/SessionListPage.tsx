/**
 * SessionListPage — main panel session list, shown at `/`.
 * Displays sessions filtered by selected project, grouped by Idle/Archived.
 * Replaces the old HomePage.
 */

import { memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../stores/sessions.js";
import { useConnectionStore } from "../stores/connection.js";
import { useSessions } from "../hooks/useSessions.js";
import {
  groupSessionsByStatus,
  filterSessionsByProject,
  formatSessionTime,
} from "../lib/sessions-utils.js";
import { ConnectAgentPanel } from "../components/ConnectAgentPanel.js";
import type { Session } from "../lib/types.js";

export function SessionListPage() {
  const navigate = useNavigate();
  const { sessions, loadingSessions, createSession } = useSessions();
  const selectedProject = useSessionStore((s) => s.selectedProject);
  const starredIds = useSessionStore((s) => s.starredSessionIds);
  const toggleStarred = useSessionStore((s) => s.toggleStarred);
  const removeSession = useSessionStore((s) => s.removeSession);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const serverUrl = useConnectionStore((s) => s.serverUrl);

  // Detect hosted mode: not on localhost
  const isHosted = !!serverUrl && !isLocalUrl(serverUrl);

  const filtered = filterSessionsByProject(sessions, selectedProject);
  const starredSet = new Set(starredIds);
  const groups = groupSessionsByStatus(filtered, starredSet);

  const handleSelect = useCallback(
    (sessionId: string) => navigate(`/chat/${sessionId}`),
    [navigate],
  );

  const handleNewSession = useCallback(async () => {
    const id = await createSession(selectedProject ?? undefined);
    if (id) navigate(`/chat/${id}`);
  }, [createSession, navigate, selectedProject]);

  const title = selectedProject ?? "All Sessions";

  if (loadingSessions && sessions.length === 0) {
    return (
      <div className="session-list-page">
        <div className="session-list-header">
          <h2 className="session-list-title">{title}</h2>
        </div>
        <div className="session-list-empty">Loading...</div>
      </div>
    );
  }

  return (
    <div className="session-list-page">
      <div className="session-list-header">
        <h2 className="session-list-title">{title}</h2>
      </div>

      {filtered.length === 0 ? (
        <div className="session-list-empty">
          {isHosted && !daemonConnected ? (
            <ConnectAgentPanel />
          ) : (
            <>
              <p>No sessions{selectedProject ? ` for ${selectedProject}` : ""}</p>
              <button className="session-list-new-btn" onClick={handleNewSession}>
                New session
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="session-list-content">
          {groups.map((group) => (
            <div key={group.dateKey} className="session-list-group">
              <div className="session-list-group-label">{group.label}</div>
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  starred={starredSet.has(session.id)}
                  onSelect={handleSelect}
                  onToggleStar={toggleStarred}
                  onDelete={removeSession}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="session-list-footer">
          <button className="session-list-new-btn" onClick={handleNewSession}>
            New session
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionRow — single-line row with title + chevron
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: Session;
  starred: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}

function SessionRowInner({
  session,
  starred,
  onSelect,
  onToggleStar,
  onDelete,
}: SessionRowProps) {
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
      className="session-row"
      onClick={() => onSelect(session.id)}
      title={session.title || session.id}
    >
      <span
        className={`session-row-star ${starred ? "starred" : ""}`}
        onClick={handleStar}
        title={starred ? "Unstar" : "Star"}
      >
        {starred ? "\u2605" : "\u2606"}
      </span>

      <span className="session-row-title">
        {session.title || `${session.id.slice(0, 12)}...`}
      </span>

      <span className="session-row-time">
        {formatSessionTime(session.updatedAt)}
      </span>

      <span
        className="session-row-delete"
        onClick={handleDelete}
        title="Remove"
      >
        &times;
      </span>

      <span className="session-row-chevron">{"\u203A"}</span>
    </button>
  );
}

const SessionRow = memo(SessionRowInner);
SessionRow.displayName = "SessionRow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
