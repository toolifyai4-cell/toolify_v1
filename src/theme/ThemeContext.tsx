import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { readConfigSync, writeConfig } from "../utils/config.js";
import { THEMES, getThemeById } from "./themes.js";
import type { Theme, ThemeTokens } from "../agent/types.js";

/**
 * Global reactive theme context.
 *
 * The provider reads the persisted theme id from ~/.toolify/config.json on
 * mount, keeps the active Theme in React state, and writes the choice back to
 * the same file when `setTheme` is called. Every consumer that reads
 * `tokens` re-renders immediately, which is what makes the switching live.
 */
export interface ThemeContextValue {
  /** The full active theme (id, name, isDark, tokens). */
  readonly theme: Theme;
  /** Shorthand for `theme.tokens` — the color map used by Ink components. */
  readonly tokens: ThemeTokens;
  /** Persist + activate a theme by id (triggers a re-render). */
  readonly setTheme: (themeId: string) => Promise<void>;
  /** Every built-in theme, in display order. */
  readonly availableThemes: readonly Theme[];
}

/**
 * Safe fallback used when a component renders outside a ThemeProvider
 * (isolated component renders, unit tests, storybook-style snapshots).
 * Using Toolify Dark keeps the historical cyan look byte-identical.
 */
const FALLBACK_CONTEXT: ThemeContextValue = {
  theme: THEMES[0]!,
  tokens: THEMES[0]!.tokens,
  setTheme: async () => {
    /* no provider mounted — nothing to persist */
  },
  availableThemes: THEMES,
};

const ThemeContext = createContext<ThemeContextValue>(FALLBACK_CONTEXT);

/** Read the persisted theme id from ~/.toolify/config.json (best effort). */
export function readPersistedThemeId(): string | undefined {
  try {
    const cfg = readConfigSync() as unknown as { theme?: string };
    return typeof cfg.theme === "string" ? cfg.theme : undefined;
  } catch {
    return undefined;
  }
}

export interface ThemeProviderProps {
  readonly children: React.ReactNode;
  /** Workspace path — accepted for API symmetry; theme persistence is global. */
  readonly workspace?: string;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const savedId = readPersistedThemeId();
    return savedId ? getThemeById(savedId) : THEMES[0]!;
  });

  const setTheme = useCallback(async (themeId: string) => {
    const next = getThemeById(themeId);
    // Optimistic local update first so the UI repaints instantly.
    setThemeState(next);
    try {
      const cfg = readConfigSync();
      cfg.theme = themeId;
      await writeConfig(cfg);
    } catch {
      // A persistence failure must never break live theme switching.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      tokens: theme.tokens,
      setTheme,
      availableThemes: THEMES,
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Read the active theme + tokens. Safe to call outside a provider. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
