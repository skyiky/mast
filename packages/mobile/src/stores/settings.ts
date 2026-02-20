import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Verbosity = "standard" | "full";
export type ColorScheme = "system" | "light" | "dark";

interface SettingsState {
  verbosity: Verbosity;
  colorScheme: ColorScheme;

  setVerbosity: (v: Verbosity) => void;
  setColorScheme: (s: ColorScheme) => void;
  toggleVerbosity: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      verbosity: "standard",
      colorScheme: "system",

      setVerbosity: (v) => set({ verbosity: v }),
      setColorScheme: (s) => set({ colorScheme: s }),
      toggleVerbosity: () =>
        set({ verbosity: get().verbosity === "standard" ? "full" : "standard" }),
    }),
    {
      name: "mast-settings",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
