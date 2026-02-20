import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME } from "../lib/themes";

export type Verbosity = "standard" | "full";

interface SettingsState {
  verbosity: Verbosity;
  theme: string;

  setVerbosity: (v: Verbosity) => void;
  setTheme: (t: string) => void;
  toggleVerbosity: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      verbosity: "standard",
      theme: DEFAULT_THEME,

      setVerbosity: (v) => set({ verbosity: v }),
      setTheme: (t) => set({ theme: t }),
      toggleVerbosity: () =>
        set({ verbosity: get().verbosity === "standard" ? "full" : "standard" }),
    }),
    {
      name: "mast-settings",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
