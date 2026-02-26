import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Verbosity = "standard" | "full";
export type SessionMode = "build" | "plan";

interface SettingsState {
  verbosity: Verbosity;
  theme: string;
  sessionMode: SessionMode;

  setVerbosity: (v: Verbosity) => void;
  setTheme: (t: string) => void;
  toggleVerbosity: () => void;
  setSessionMode: (m: SessionMode) => void;
  toggleSessionMode: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      verbosity: "standard",
      theme: "terminal-dark",
      sessionMode: "build",

      setVerbosity: (v) => set({ verbosity: v }),
      setTheme: (t) => set({ theme: t }),
      toggleVerbosity: () =>
        set({ verbosity: get().verbosity === "standard" ? "full" : "standard" }),
      setSessionMode: (m) => set({ sessionMode: m }),
      toggleSessionMode: () =>
        set({ sessionMode: get().sessionMode === "build" ? "plan" : "build" }),
    }),
    {
      name: "mast-settings",
      // Zustand v5 defaults to localStorage — no storage option needed.
    },
  ),
);
