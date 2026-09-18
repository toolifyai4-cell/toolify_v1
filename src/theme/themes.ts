import type { Theme, ThemeTokens } from "../agent/types.js";

/**
 * Built-in theme presets.
 * Each theme defines a complete set of color tokens mapped to Ink/ANSI color names.
 * Ink supports: black, red, green, yellow, blue, magenta, cyan, white,
 * blackBright (gray), redBright, greenBright, yellowBright, blueBright, magentaBright, cyanBright, whiteBright,
 * plus dim, bold, etc. as style props.
 */
/** Get a theme by its ID, falling back to Toolify Dark. */
export function getThemeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** Get all theme IDs for validation. */
export function getThemeIds(): readonly string[] {
  return THEMES.map((t) => t.id);
}
export const THEMES: readonly Theme[] = [
  {
    id: "toolify-dark",
    name: "Toolify Dark",
    isDark: true,
    tokens: {
      primary: "cyan",
      secondary: "blue",
      background: "black",
      surface: "blackBright",
      border: "cyan",
      text: "white",
      textMuted: "gray",
      textInverted: "black",
      accent: "cyan",
      success: "green",
      warning: "yellow",
      error: "red",
      info: "blue",
    },
  },
  {
    id: "monochrome",
    name: "Monochrome",
    isDark: true,
    tokens: {
      primary: "white",
      secondary: "gray",
      background: "black",
      surface: "blackBright",
      border: "white",
      text: "white",
      textMuted: "gray",
      textInverted: "black",
      accent: "white",
      success: "white",
      warning: "white",
      error: "white",
      info: "white",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    isDark: true,
    tokens: {
      primary: "green",
      secondary: "greenBright",
      background: "black",
      surface: "blackBright",
      border: "green",
      text: "greenBright",
      textMuted: "green",
      textInverted: "black",
      accent: "greenBright",
      success: "greenBright",
      warning: "yellow",
      error: "red",
      info: "green",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    isDark: true,
    tokens: {
      primary: "magenta",
      secondary: "blue",
      background: "black",
      surface: "blackBright",
      border: "magenta",
      text: "white",
      textMuted: "gray",
      textInverted: "black",
      accent: "yellow",
      success: "green",
      warning: "yellow",
      error: "red",
      info: "cyan",
    },
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];