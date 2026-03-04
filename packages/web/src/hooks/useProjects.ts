/**
 * useProjects — fetches the project list and keeps it in a shared Zustand store.
 *
 * Returns `{ projects, loading }` where projects is the list of configured
 * projects with name, directory, port, and ready status.
 *
 * Because the data lives in the Zustand store, any component consuming
 * useProjectStore will see updates immediately (e.g., when SettingsPage
 * removes a project, the sidebar updates without a page reload).
 */

import { useEffect } from "react";
import { useApi } from "./useApi.js";
import { useProjectStore } from "../stores/projects.js";
import type { Project } from "../lib/api.js";

export function useProjects() {
  const api = useApi();
  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const setProjects = useProjectStore((s) => s.setProjects);
  const setLoading = useProjectStore((s) => s.setLoading);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await api.projects();
        if (cancelled) return;
        if (res.status === 200 && Array.isArray(res.body)) {
          setProjects(res.body as Project[]);
        }
      } catch {
        // Best-effort — projects list is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [api, setProjects, setLoading]);

  return { projects, loading };
}
