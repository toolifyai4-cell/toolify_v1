import React from "react";
import { Box, Text } from "ink";

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
}

/**
 * Slash commands offered by the floating autocomplete menu.
 * Keep in sync with the handlers in `src/cli/chat.tsx` (`onSubmit`).
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/settings", description: "Modify agent configuration" },
  { name: "/model", description: "Switch model or provider" },
  { name: "/theme", description: "Change color theme" },
  { name: "/account", description: "View Toolify account" },
  { name: "/history", description: "Recent conversation turns" },
  { name: "/help", description: "Show available commands" },
  { name: "/usage", description: "View token consumption and cost" },
  { name: "/quit", description: "Exit TOOLIFY application" },
];

/** Max command rows visible inside the floating box before scrolling. */
export const COMMAND_MENU_PAGE_SIZE = 6;

/**
 * Filter commands by what the user typed after `/` (case-insensitive
 * prefix match on the name without the leading slash).
 * `/` -> all commands, `/set` -> [/settings], `/zzz` -> [].
 */
export function filterSlashCommands(
  query: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...commands];
  return commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(q));
}

export interface CommandMenuProps {
  /** Filtered commands to show. */
  readonly commands: readonly SlashCommand[];
  /** Index into `commands` of the highlighted row. */
  readonly selectedIndex: number;
  /** Max visible rows; extra rows scroll with a `v X more` indicator. */
  readonly pageSize?: number;
}

/**
 * Floating slash-command autocomplete menu.
 *
 * Rendered directly above the input prompt: single-line bordered box, one
 * row per command (`justifyContent="space-between"`, name left / description
 * right), active row highlighted across the full line with a `> ` prefix.
 * When more than `pageSize` commands match, a 6-row window follows the
 * selection and a `v X more` line reports the hidden remainder.
 */
export function CommandMenu({
  commands,
  selectedIndex,
  pageSize = COMMAND_MENU_PAGE_SIZE,
}: CommandMenuProps): React.ReactElement | null {
  if (commands.length === 0) return null;

  const safeSelected = Math.min(Math.max(selectedIndex, 0), commands.length - 1);
  // Scroll the visible window so the highlighted row stays in view.
  const start = Math.min(
    Math.max(safeSelected - pageSize + 1, 0),
    Math.max(commands.length - pageSize, 0),
  );
  const visible = commands.slice(start, start + pageSize);
  const hiddenCount = commands.length - visible.length;

  return (
    <Box borderStyle="single" borderColor="cyan" flexDirection="column" paddingX={1}>
      {visible.map((cmd, i) => {
        const absoluteIndex = start + i;
        const active = absoluteIndex === safeSelected;
        return (
          <Box key={cmd.name} justifyContent="space-between">
            {active ? (
              <Box flexGrow={1} justifyContent="space-between" backgroundColor="cyan">
                <Text color="black" bold>
                  {`> ${cmd.name}`}
                </Text>
                <Text color="black"> {cmd.description}</Text>
              </Box>
            ) : (
              <>
                <Text>
                  {"  "}
                  {cmd.name}
                </Text>
                <Text dimColor> {cmd.description}</Text>
              </>
            )}
          </Box>
        );
      })}
      {hiddenCount > 0 && (
        <Box>
          <Text dimColor>{`\u25bc ${hiddenCount} more`}</Text>
        </Box>
      )}
    </Box>
  );
}
