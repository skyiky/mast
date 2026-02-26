/**
 * useProjects — fetches the project list from the orchestrator.
 *
 * Returns `{ projects, loading }` where projects is the list of configured
 * projects with name, directory, port, and ready status.
 */

import { useState, useEffect } from "react";
import { useApi } from "./useApi.js";
import type { Project } from "../lib/api.js";

export function useProjects() {
  const api = useApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

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
  }, [api]);

  return { projects, loading };
}
