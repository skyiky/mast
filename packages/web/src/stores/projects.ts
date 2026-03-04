/**
 * Zustand store for the project list.
 *
 * Shared between Layout (sidebar) and SettingsPage so that adding/removing
 * a project in settings immediately updates the sidebar project tabs.
 */

import { create } from "zustand";
import type { Project } from "../lib/api.js";

interface ProjectState {
  /** All known projects from the daemon */
  projects: Project[];
  /** Whether the initial fetch is in progress */
  loading: boolean;

  // Actions
  setProjects: (projects: Project[]) => void;
  setLoading: (loading: boolean) => void;
  /** Optimistically remove a project by name (before API confirms) */
  removeLocally: (name: string) => void;
  /** Add a project to the local list (after API confirms) */
  addLocally: (project: Project) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  loading: true,

  setProjects: (projects) => set({ projects }),
  setLoading: (loading) => set({ loading }),

  removeLocally: (name) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.name !== name),
    })),

  addLocally: (project) =>
    set((state) => ({
      projects: [...state.projects, project],
    })),
}));
