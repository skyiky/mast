/**
 * SettingsPage — connection status, toggles, sign out.
 *
 * Sections:
 * - Connection status (server URL, WS, daemon, OpenCode)
 * - Verbosity toggle (standard / full)
 * - Mode toggle (build / plan)
 * - Re-pair device
 * - Sign out
 */

import { useConnectionStore } from "../stores/connection.js";
import { useSettingsStore } from "../stores/settings.js";
import { supabase } from "../lib/supabase.js";
import "../styles/settings.css";

export function SettingsPage() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);
  const connectionSignOut = useConnectionStore((s) => s.signOut);
  const reset = useConnectionStore((s) => s.reset);

  const verbosity = useSettingsStore((s) => s.verbosity);
  const toggleVerbosity = useSettingsStore((s) => s.toggleVerbosity);
  const sessionMode = useSettingsStore((s) => s.sessionMode);
  const toggleSessionMode = useSettingsStore((s) => s.toggleSessionMode);

  return (
    <div className="settings-page">
      {/* // connection */}
      <div className="settings-section">
        <div className="settings-section-title">// connection</div>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-label">server</span>
            <span className="settings-value">{serverUrl || "not set"}</span>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <StatusDot ok={wsConnected} />
            <span className="settings-label">websocket</span>
            <span className="settings-value">
              {wsConnected ? "connected" : "disconnected"}
            </span>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <StatusDot ok={daemonConnected} />
            <span className="settings-label">daemon</span>
            <span className="settings-value">
              {daemonConnected ? "connected" : "disconnected"}
            </span>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <StatusDot ok={opencodeReady} />
            <span className="settings-label">opencode</span>
            <span className="settings-value">
              {opencodeReady ? "ready" : "not ready"}
            </span>
          </div>
        </div>
      </div>

      {/* // controls */}
      <div className="settings-section">
        <div className="settings-section-title">// controls</div>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-label">verbosity</span>
            <div className="settings-toggle-group">
              <button
                className={`settings-toggle-btn ${verbosity === "standard" ? "active" : ""}`}
                onClick={toggleVerbosity}
              >
                std
              </button>
              <button
                className={`settings-toggle-btn ${verbosity === "full" ? "active" : ""}`}
                onClick={toggleVerbosity}
              >
                full
              </button>
            </div>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <span className="settings-label">mode</span>
            <div className="settings-toggle-group">
              <button
                className={`settings-toggle-btn ${sessionMode === "build" ? "active" : ""}`}
                onClick={toggleSessionMode}
              >
                build
              </button>
              <button
                className={`settings-toggle-btn ${sessionMode === "plan" ? "active" : ""}`}
                onClick={toggleSessionMode}
              >
                plan
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* // actions */}
      <div className="settings-section">
        <div className="settings-section-title">// actions</div>
        <div className="settings-card">
          <button className="settings-action-btn warning" onClick={reset}>
            [re-pair device]
          </button>
          <div className="settings-divider" />
          <button
            className="settings-action-btn danger"
            onClick={() => {
              supabase.auth.signOut();
              connectionSignOut();
            }}
          >
            [sign out]
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`settings-status-dot ${ok ? "ok" : "error"}`}
    />
  );
}
