import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

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
 * Total terminal rows the menu occupies when open: 2 border rows +
 * visible command rows + 1 overflow footer row (when hidden commands
 * remain) + 1 margin row below the box.
 *
 * Callers (ChatUI) reserve this from the transcript budget so the frame
 * always totals exactly the terminal height and Yoga never shrinks the
 * boxes (which makes menu rows overwrite each other).
 */
export function estimateMenuHeight(
  commandCount: number,
  pageSize: number = COMMAND_MENU_PAGE_SIZE,
): number {
  const visible = Math.min(Math.max(commandCount, 0), Math.max(pageSize, 0));
  const footer = commandCount > visible ? 1 : 0;
  return 2 + visible + footer + 1;
}

/** Name column width inside each menu row. */
const NAME_COL_WIDTH = 14;

/**
 * Chrome around the content: 2 (border) + 2 (paddingX) + 1 (measurement
 * slack). Verified empirically: `NAME_COL_WIDTH + 1 + maxDesc + MENU_CHROME`
 * equals the natural box width (46 for a 26-char longest description, 51
 * for 31) — so the box hugs the widest row exactly.
 */
const MENU_CHROME = 5;

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
  const { tokens } = useTheme();
  if (commands.length === 0) return null;

  const safeSelected = Math.min(Math.max(selectedIndex, 0), commands.length - 1);
  // Scroll the visible window so the highlighted row stays in view.
  const start = Math.min(
    Math.max(safeSelected - pageSize + 1, 0),
    Math.max(commands.length - pageSize, 0),
  );
  const visible = commands.slice(start, start + pageSize);
  const hiddenCount = commands.length - visible.length;

  // Stable, content-hugging width: the box fits the widest row exactly and
  // never changes size while scrolling (only when the filtered list changes).
  const maxDesc = commands.reduce((m, c) => Math.max(m, c.description.length), 0);
  const boxWidth = NAME_COL_WIDTH + 1 + maxDesc + MENU_CHROME;

    return (
      <Box
      borderStyle="round"
      borderColor={tokens.border}
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
      alignItems="stretch"
      width={boxWidth}
    >
      {visible.map((cmd, i) => {
        const absoluteIndex = start + i;
        const active = absoluteIndex === safeSelected;
    return (
    <Box
            key={cmd.name}
            flexDirection="row"
            flexGrow={1}
            backgroundColor={active ? tokens.primary : undefined}
          >
            <Box width={NAME_COL_WIDTH} flexShrink={0}>
              <Text
                color={active ? tokens.textInverted : tokens.text}
                bold={active}
                wrap="truncate"
              >
                {active ? `> ${cmd.name}` : `  ${cmd.name}`}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} paddingLeft={1} minWidth={0}>
              <Text
                color={active ? tokens.textInverted : undefined}
                dimColor={!active}
                wrap="truncate"
              >
                {cmd.description}
              </Text>
            </Box>
          </Box>
        );
      })}
      {hiddenCount > 0 && (
        <Box>
          <Text dimColor>{`▼ ${hiddenCount} more`}</Text>
        </Box>
      )}
    </Box>
  );
}
