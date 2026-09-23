import type { ThemeTokens } from "../agent/types.js";

/**
 * Provider-specific color palette.
 *
 * When the user selects "Provider Theme" in settings, the UI tokens are
 * resolved from this map keyed by the active provider id. Unknown providers
 * fall back to the default (nexipi-dark) tokens — the app never crashes.
 *
 * Ink named colors are used where possible; for orange (no named color in
 * Ink's palette) we use 256-color ANSI escape strings, which Ink forwards
 * verbatim to the terminal.
 */

/** 256-color ANSI escape sequences used for hues Ink can't name. */
export const ANSI256 = {
  orange: "\x1b[38;5;208m",
  orangeBright: "\x1b[38;5;202m",
  reset: "\x1b[39m",
} as const;

/** Default tokens applied when the provider is unknown or unmapped. */
export function defaultProviderTokens(): ThemeTokens {
  return {
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
  };
}

/**
 * Resolve the color tokens for a given provider id.
 * Returns a complete ThemeTokens — never partial, never undefined.
 */
export function getProviderTokens(providerId: string | undefined | null): ThemeTokens {
  const key = (providerId ?? "").toLowerCase();
  const map = PROVIDER_TOKEN_MAP[key];
  return map ? { ...defaultProviderTokens(), ...map } : defaultProviderTokens();
}

/**
 * Map of provider id → partial tokens (only the hues that change per provider).
 * Semantic tokens (success/warning/error/text) stay constant so the UI
 * keeps its meaning regardless of which provider is active.
 */
const PROVIDER_TOKEN_MAP: Record<string, Partial<ThemeTokens>> = {
  // Gemini / Google — blue
  gemini: { primary: "blue", border: "blue", accent: "blueBright", info: "blue" },
  google: { primary: "blue", border: "blue", accent: "blueBright", info: "blue" },

  // Claude / Anthropic — orange
  anthropic: { primary: ANSI256.orange, border: ANSI256.orange, accent: ANSI256.orangeBright, info: ANSI256.orange },
  claude: { primary: ANSI256.orange, border: ANSI256.orange, accent: ANSI256.orangeBright, info: ANSI256.orange },

  // OpenAI — green
  openai: { primary: "green", border: "green", accent: "greenBright", info: "green" },

  // OpenRouter — magenta
  openrouter: { primary: "magenta", border: "magenta", accent: "magentaBright", info: "magenta" },

  // OmniRoute — teal (cyan)
  omniroute: { primary: "cyan", border: "cyan", accent: "cyanBright", info: "cyan" },

  // Unorouter — purple (blue)
  unorouter: { primary: "blue", border: "blue", accent: "blueBright", info: "blue" },
};