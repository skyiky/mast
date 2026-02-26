/**
 * SessionsPage — main session list view.
 * Fetches sessions on mount, renders grouped by day with project filter.
 * "New Session" button creates a session and navigates to chat.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../stores/sessions.js";
import { useApi } from "../hooks/useApi.js";
import { SessionRow } from "../components/SessionRow.js";
import { ProjectFilterBar } from "../components/ProjectFilterBar.js";
import {
  getUniqueProjects,
  filterSessionsByProject,
  groupSessionsByDay,
} from "../lib/sessions-utils.js";
import type { Session } from "../lib/types.js";
import "../styles/sessions.css";

export function SessionsPage() {
  const navigate = useNavigate();
  const api = useApi();
  const sessions = useSessionStore((s) => s.sessions);
  const deletedSessionIds = useSessionStore((s) => s.deletedSessionIds);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setLoadingSessions = useSessionStore((s) => s.setLoadingSessions);
  const loadingSessions = useSessionStore((s) => s.loadingSessions);

  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch sessions on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingSessions(true);
      setError(null);
      try {
        const res = await api.sessions();
        if (cancelled) return;
        if (res.status === 200 && Array.isArray(res.body)) {
          // Map API response to Session shape
          const mapped: Session[] = res.body.map((s) => ({
            id: s.id,
            title: s.title ?? s.slug,
            directory: s.directory,
            project: s.project,
            createdAt: s.createdAt ?? new Date().toISOString(),
            updatedAt: s.createdAt ?? new Date().toISOString(),
          }));
          setSessions(mapped);
        } else {
          setError("Failed to load sessions");
        }
      } catch (err) {
        if (!cancelled) setError("Network error loading sessions");
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [api, setSessions, setLoadingSessions]);

  // Create new session
  const handleNewSession = useCallback(async () => {
    try {
      const res = await api.newSession(selectedProject ?? undefined);
      if (res.status === 200 && res.body?.id) {
        navigate(`/chat/${res.body.id}`);
      }
    } catch {
      // Best-effort — errors will be visible in the chat page
    }
  }, [api, selectedProject, navigate]);

  // Filter out deleted sessions, apply project filter, group
  const visible = sessions.filter((s) => !deletedSessionIds.includes(s.id));
  const projects = getUniqueProjects(visible);
  const filtered = filterSessionsByProject(visible, selectedProject);
  const groups = groupSessionsByDay(filtered);

  return (
    <div className="sessions-page">
      <div className="sessions-header">
        <h2 className="sessions-title">Sessions</h2>
        <button className="new-session-btn" onClick={handleNewSession}>
          + new
        </button>
      </div>

      <ProjectFilterBar
        projects={projects}
        selected={selectedProject}
        onSelect={setSelectedProject}
      />

      {loadingSessions && sessions.length === 0 && (
        <div className="sessions-empty">Loading sessions...</div>
      )}

      {error && <div className="sessions-error">{error}</div>}

      {!loadingSessions && !error && groups.length === 0 && (
        <div className="sessions-empty">
          No sessions yet. Create one to get started.
        </div>
      )}

      <div className="sessions-list">
        {groups.map((group) => (
          <div key={group.dateKey} className="session-group">
            <div className="session-group-label">{group.label}</div>
            {group.sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
