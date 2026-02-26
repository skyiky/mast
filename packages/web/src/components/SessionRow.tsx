/**
 * SessionRow — a single session entry in the list.
 * Shows activity dot, title, time ago, and last message preview.
 */

import { memo } from "react";
import { Link } from "react-router-dom";
import type { Session } from "../lib/types.js";
import { getTimeAgo } from "../lib/sessions-utils.js";

interface SessionRowProps {
  session: Session;
}

function SessionRowInner({ session }: SessionRowProps) {
  const timeAgo = getTimeAgo(session.updatedAt || session.createdAt);

  return (
    <Link to={`/chat/${session.id}`} className="session-row">
      {/* Activity dot */}
      <span
        className={`session-dot ${session.hasActivity ? "active" : ""}`}
      >
        {session.hasActivity ? "\u25CF" : "\u25CB"}
      </span>

      {/* Content */}
      <div className="session-row-content">
        <div className="session-row-top">
          <span className="session-title">
            {session.title || `${session.id.slice(0, 8)}...`}
          </span>
          <span className="session-time">{timeAgo}</span>
        </div>
        {session.lastMessagePreview && (
          <p className="session-preview">{session.lastMessagePreview}</p>
        )}
      </div>
    </Link>
  );
}

export const SessionRow = memo(SessionRowInner);
SessionRow.displayName = "SessionRow";
