/**
 * Theme definitions for Mast.
 *
 * Each theme is a set of semantic color tokens. Components read these
 * via useTheme() and apply them as inline styles. Adding a new theme
 * is just adding a new object here — zero component changes needed.
 */

export interface ThemeColors {
  /** Main background — OLED black or equivalent */
  bg: string;
  /** Elevated surfaces — cards, input bars */
  surface: string;
  /** Subtle separators, borders */
  border: string;
  /** Timestamps, tertiary text */
  dim: string;
  /** Labels, secondary text */
  muted: string;
  /** Primary body text */
  text: string;
  /** Headings, user input, emphasis */
  bright: string;
  /** User input accent, interactive elements */
  accent: string;
  /** Subtle accent background */
  accentDim: string;
  /** Agent output, success, approved */
  success: string;
  /** Subtle success background */
  successDim: string;
  /** Warnings, permission cards */
  warning: string;
  /** Subtle warning background */
  warningDim: string;
  /** Errors, denied */
  danger: string;
  /** Subtle danger background */
  dangerDim: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
}

// ---------------------------------------------------------------------------
// Built-in themes
// ---------------------------------------------------------------------------

export const terminalDark: Theme = {
  name: "Terminal Dark",
  colors: {
    bg: "#0A0A0A",
    surface: "#141414",
    border: "#262626",
    dim: "#525252",
    muted: "#737373",
    text: "#D4D4D4",
    bright: "#FAFAFA",
    accent: "#22D3EE",
    accentDim: "#164E63",
    success: "#22C55E",
    successDim: "#166534",
    warning: "#F59E0B",
    warningDim: "#78350F",
    danger: "#EF4444",
    dangerDim: "#7F1D1D",
  },
};

// Future themes go here:
// export const catppuccinMocha: Theme = { ... };
// export const gruvboxDark: Theme = { ... };
// export const dracula: Theme = { ... };
// export const nord: Theme = { ... };

// ---------------------------------------------------------------------------
// Theme registry
// ---------------------------------------------------------------------------

const themes: Record<string, Theme> = {
  "terminal-dark": terminalDark,
};

export const DEFAULT_THEME = "terminal-dark";

export function getTheme(name: string): Theme {
  return themes[name] ?? terminalDark;
}

export function getThemeNames(): string[] {
  return Object.keys(themes);
}

// ---------------------------------------------------------------------------
// Font family constants — JetBrains Mono loaded via expo-font
// ---------------------------------------------------------------------------

export const fonts = {
  light: "JetBrainsMono_300Light",
  regular: "JetBrainsMono_400Regular",
  medium: "JetBrainsMono_500Medium",
  semibold: "JetBrainsMono_600SemiBold",
  bold: "JetBrainsMono_700Bold",
} as const;
