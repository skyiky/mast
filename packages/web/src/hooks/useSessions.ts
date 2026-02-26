/**
 * useSessions — fetches sessions on mount and provides session list utilities.
 * Extracted from SessionsPage so the sidebar can also use it.
 */

import { useState, useEffect, useCallback } from "react";
import { useSessionStore } from "../stores/sessions.js";
import { useApi } from "./useApi.js";
import type { Session } from "../lib/types.js";

export function useSessions() {
  const api = useApi();
  const sessions = useSessionStore((s) => s.sessions);
  const deletedSessionIds = useSessionStore((s) => s.deletedSessionIds);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setLoadingSessions = useSessionStore((s) => s.setLoadingSessions);
  const loadingSessions = useSessionStore((s) => s.loadingSessions);

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
          const mapped: Session[] = res.body.map((s: Record<string, unknown>) => ({
            id: s.id as string,
            title: (s.title ?? s.slug) as string | undefined,
            directory: s.directory as string | undefined,
            project: s.project as string | undefined,
            createdAt: (s.createdAt ?? new Date().toISOString()) as string,
            updatedAt: (s.createdAt ?? new Date().toISOString()) as string,
          }));
          setSessions(mapped);
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
  }, [api, setSessions, setLoadingSessions]);

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
