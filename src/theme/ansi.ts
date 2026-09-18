/**
 * Maps Ink/ANSI color names to raw SGR escape sequences.
 *
 * Theme tokens store color *names* (what Ink's `color`/`borderColor` props
 * accept). Some legacy render paths interpolate raw escape codes inside text
 * strings; `ansi()` bridges the two so those paths become theme-reactive too.
 */
export const ANSI_BY_COLOR: Record<string, string> = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  blackBright: "\x1b[90m",
  redBright: "\x1b[91m",
  greenBright: "\x1b[92m",
  yellowBright: "\x1b[93m",
  blueBright: "\x1b[94m",
  magentaBright: "\x1b[95m",
  cyanBright: "\x1b[96m",
  whiteBright: "\x1b[97m",
};

/** Resolve a theme token color name to its ANSI escape ("" when unknown). */
export function ansi(color: string): string {
  return ANSI_BY_COLOR[color] ?? "";
}
