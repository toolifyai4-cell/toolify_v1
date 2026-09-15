/**
 * Full-screen terminal helpers shared by the entry flow and the chat UI.
 *
 * Why this file exists:
 *   Ink's `unmount()` tears the React tree down but LEAVES the last painted
 *   frame on screen, and every `render()` call creates a new root that draws at
 *   the current cursor position. Rendering a sequence of screens
 *   (splash -> sign-in -> chat) therefore stacked every frame on top of the
 *   previous one, leaving the sign-in boxes visible behind the chat.
 *
 *   Ink's `instance.clear()` erases the frame but is a silent no-op unless Ink
 *   is in interactive mode (ink.js: `if (this.interactive && !this.options.debug)`),
 *   so `clearScreen()` emits raw ANSI that works regardless of Ink's mode.
 */

/**
 * Force the TTY flags on. On Windows, `npx`/`tsx` frequently reports
 * `process.stdout.isTTY === false` even inside a real terminal, which makes
 * Ink skip full-screen rendering entirely.
 */
export function patchTtyForFullScreen(): void {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
}

/**
 * Take over the terminal at startup: hide the cursor, wipe the screen AND the
 * scrollback buffer, park the cursor top-left, then restore the cursor.
 */
export function takeOverScreen(stream: NodeJS.WriteStream = process.stdout): void {
  stream.write("\u001b[?25l\u001b[2J\u001b[3J\u001b[H\u001b[?25h");
}

/**
 * Erase everything currently painted and park the cursor at the top-left.
 *
 * Deliberately does NOT use `ESC[3J` (scrollback wipe): previously painted
 * screens slide into scrollback instead of being destroyed, so the user can
 * still scroll back to read them.
 */
export function clearScreen(stream: NodeJS.WriteStream = process.stdout): void {
  stream.write("\u001b[2J\u001b[H");
}

/**
 * Ink only clears its frame in interactive mode; ask for it explicitly so we
 * get correct redraw behaviour even when auto-detection guesses wrong.
 * Passed to every `render()` call alongside the TTY patch above.
 */
export const FULLSCREEN_RENDER_OPTIONS = {
  exitOnCtrlC: false,
  interactive: true,
} as const;