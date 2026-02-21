import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME } from "../lib/themes";

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
      theme: DEFAULT_THEME,
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
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
