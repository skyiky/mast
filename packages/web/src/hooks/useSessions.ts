/**
 * useSessions — fetches sessions on mount and provides session list utilities.
 * Extracted from SessionsPage so the sidebar can also use it.
 */

import { useState, useEffect, useCallback } from "react";
import { useSessionStore } from "../stores/sessions.js";
import { useConnectionStore } from "../stores/connection.js";
import { useApi } from "./useApi.js";
import { mapRawSessions } from "../lib/sessions-utils.js";

export function useSessions() {
  const api = useApi();
  const sessions = useSessionStore((s) => s.sessions);
  const deletedSessionIds = useSessionStore((s) => s.deletedSessionIds);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setLoadingSessions = useSessionStore((s) => s.setLoadingSessions);
  const loadingSessions = useSessionStore((s) => s.loadingSessions);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);

  const [error, setError] = useState<string | null>(null);

  // Fetch sessions on mount and when daemon connects
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingSessions(true);
      setError(null);
      try {
        const res = await api.sessions();
        if (cancelled) return;
        if (res.status === 200 && Array.isArray(res.body)) {
          setSessions(mapRawSessions(res.body as Record<string, unknown>[]));
        } else {
          setError("Failed to load sessions");
        }
      } catch {
        if (!cancelled) setError("Network error loading sessions");
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [api, setSessions, setLoadingSessions, daemonConnected]);

  // Filter out deleted sessions
  const visible = sessions.filter((s) => !deletedSessionIds.includes(s.id));

  // Create new session
  const createSession = useCallback(async (project?: string): Promise<string | null> => {
    try {
      const res = await api.newSession(project);
      if (res.status === 200 && res.body?.id) {
        return res.body.id as string;
      }
    } catch {
      // Best-effort
    }
    return null;
  }, [api]);

  return { sessions: visible, loadingSessions, error, createSession };
}
