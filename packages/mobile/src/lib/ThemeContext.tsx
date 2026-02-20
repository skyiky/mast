/**
 * ThemeContext — provides the active theme to all components via useTheme().
 */

import React, { createContext, useContext, useMemo } from "react";
import { type Theme, getTheme } from "./themes";
import { useSettingsStore } from "../stores/settings";

const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme() must be used within a <ThemeProvider>");
  }
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeName = useSettingsStore((s) => s.theme);
  const theme = useMemo(() => getTheme(themeName), [themeName]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}
