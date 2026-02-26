/**
 * ConnectionStatus — compact connection status footer for the sidebar.
 * Shows colored dots for WS, daemon, and OpenCode status.
 * Expands on click to show details.
 */

import { useState, memo } from "react";
import { useConnectionStore } from "../stores/connection.js";
import "../styles/components.css";

function ConnectionStatusInner() {
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);
  const [expanded, setExpanded] = useState(false);

  const allGood = wsConnected && daemonConnected && opencodeReady;

  // Count issues for the summary
  const issues: string[] = [];
  if (!wsConnected) issues.push("ws");
  if (!daemonConnected) issues.push("daemon");
  if (!opencodeReady) issues.push("opencode");

  return (
    <div className="connection-status-footer">
      <button
        className="connection-status-summary"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="connection-status-dots">
          <span className={`cs-dot ${wsConnected ? "ok" : "error"}`} title="WebSocket" />
          <span className={`cs-dot ${daemonConnected ? "ok" : "error"}`} title="Daemon" />
          <span className={`cs-dot ${opencodeReady ? "ok" : "warning"}`} title="OpenCode" />
        </span>
        <span className="connection-status-text">
          {allGood ? "connected" : issues.join(", ") + " \u2717"}
        </span>
        <span className="connection-status-chevron">
          {expanded ? "\u25B4" : "\u25BE"}
        </span>
      </button>

      {expanded && (
        <div className="connection-status-details">
          <div className="cs-detail-row">
            <span className={`cs-dot ${wsConnected ? "ok" : "error"}`} />
            <span className="cs-detail-label">websocket</span>
            <span className={`cs-detail-value ${wsConnected ? "ok" : "error"}`}>
              {wsConnected ? "connected" : "disconnected"}
            </span>
          </div>
          <div className="cs-detail-row">
            <span className={`cs-dot ${daemonConnected ? "ok" : "error"}`} />
            <span className="cs-detail-label">daemon</span>
            <span className={`cs-detail-value ${daemonConnected ? "ok" : "error"}`}>
              {daemonConnected ? "connected" : "disconnected"}
            </span>
          </div>
          <div className="cs-detail-row">
            <span className={`cs-dot ${opencodeReady ? "ok" : "warning"}`} />
            <span className="cs-detail-label">opencode</span>
            <span className={`cs-detail-value ${opencodeReady ? "ok" : "warning"}`}>
              {opencodeReady ? "ready" : "starting..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export const ConnectionStatus = memo(ConnectionStatusInner);
ConnectionStatus.displayName = "ConnectionStatus";
