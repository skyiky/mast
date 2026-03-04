/**
 * SettingsPage — connection status, projects, toggles, sign out.
 *
 * Sections:
 * - Connection status (server URL, WS, daemon, OpenCode)
 * - Projects (list, add, remove)
 * - Verbosity toggle (standard / full)
 * - Mode toggle (build / plan)
 * - Re-pair device
 * - Sign out
 */

import { useState } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { useSettingsStore } from "../stores/settings.js";
import { useProjectStore } from "../stores/projects.js";
import { useApi } from "../hooks/useApi.js";
import { supabase } from "../lib/supabase.js";
import type { Project } from "../lib/api.js";
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

  const api = useApi();

  // --- Project state (shared Zustand store) ---
  const projects = useProjectStore((s) => s.projects);
  const loadingProjects = useProjectStore((s) => s.loading);
  const storeSetProjects = useProjectStore((s) => s.setProjects);
  const removeLocally = useProjectStore((s) => s.removeLocally);
  const addLocally = useProjectStore((s) => s.addLocally);
  const [addFormVisible, setAddFormVisible] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDir, setProjectDir] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddProject = async () => {
    const name = projectName.trim();
    const dir = projectDir.trim();
    if (!name || !dir) {
      setAddError("both name and directory are required");
      return;
    }
    setAddingProject(true);
    setAddError(null);
    try {
      const res = await api.addProject(name, dir);
      if (res.status >= 200 && res.status < 300) {
        setAddFormVisible(false);
        setProjectName("");
        setProjectDir("");
        // Update shared store with the new project
        const body = res.body as Project;
        if (body?.name) {
          addLocally(body);
        } else {
          // Fallback: re-fetch all projects
          const listRes = await api.projects();
          if (listRes.status === 200 && Array.isArray(listRes.body)) {
            storeSetProjects(listRes.body as Project[]);
          }
        }
      } else {
        const msg = (res.body as any)?.error ?? "failed to add project";
        setAddError(msg);
      }
    } catch {
      setAddError("failed to add project — check connection");
    } finally {
      setAddingProject(false);
    }
  };

  const handleRemoveProject = async (project: Project) => {
    if (!confirm(`Remove "${project.name}"? This will shut down its OpenCode instance.`)) {
      return;
    }
    // Optimistically remove from shared store
    removeLocally(project.name);
    try {
      const res = await api.removeProject(project.name);
      if (res.status !== 200) {
        // Revert: re-fetch the real list
        const listRes = await api.projects();
        if (listRes.status === 200 && Array.isArray(listRes.body)) {
          storeSetProjects(listRes.body as Project[]);
        }
      }
    } catch {
      // Revert: re-fetch
      try {
        const listRes = await api.projects();
        if (listRes.status === 200 && Array.isArray(listRes.body)) {
          storeSetProjects(listRes.body as Project[]);
        }
      } catch { /* best-effort */ }
    }
  };

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

      {/* // projects */}
      <div className="settings-section">
        <div className="settings-section-title">// projects</div>
        <div className="settings-card">
          {loadingProjects && projects.length === 0 ? (
            <div className="settings-row">
              <span className="settings-label" style={{ color: "var(--dim)" }}>loading...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="settings-row">
              <span className="settings-label" style={{ color: "var(--dim)" }}>no projects configured</span>
            </div>
          ) : (
            projects.map((project, index) => (
              <div key={project.name}>
                {index > 0 && <div className="settings-divider" />}
                <div className="settings-project-row">
                  <StatusDot ok={project.ready} />
                  <div className="settings-project-info">
                    <span className="settings-project-name">{project.name}</span>
                    <span className="settings-project-dir">{project.directory}</span>
                  </div>
                  <span className="settings-project-status" data-ready={project.ready}>
                    {project.ready ? "ready" : "starting"}
                  </span>
                  <button
                    className="settings-project-remove"
                    onClick={() => handleRemoveProject(project)}
                    title={`Remove ${project.name}`}
                  >
                    x
                  </button>
                </div>
              </div>
            ))
          )}
          <div className="settings-divider" />
          {addFormVisible ? (
            <div className="settings-add-form">
              <label className="settings-input-label">name</label>
              <input
                className="settings-input"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-project"
                autoFocus
              />
              <label className="settings-input-label">directory</label>
              <input
                className="settings-input"
                type="text"
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
                placeholder="/home/user/projects/my-project"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddProject(); }}
              />
              {addError && (
                <div className="settings-add-error">{addError}</div>
              )}
              <div className="settings-add-actions">
                <button
                  className="settings-action-btn success"
                  onClick={handleAddProject}
                  disabled={addingProject}
                >
                  {addingProject ? "adding..." : "[add]"}
                </button>
                <button
                  className="settings-action-btn"
                  onClick={() => {
                    setAddFormVisible(false);
                    setProjectName("");
                    setProjectDir("");
                    setAddError(null);
                  }}
                >
                  [cancel]
                </button>
              </div>
            </div>
          ) : (
            <button
              className="settings-action-btn accent"
              onClick={() => setAddFormVisible(true)}
            >
              [add project]
            </button>
          )}
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
