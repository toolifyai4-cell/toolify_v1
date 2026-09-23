import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

/** Top-level settings tabs (←/→ to switch). */
const TABS: readonly string[] = [
  "General",
  "MCP",
  "Skills",
  "Rules",
  "Tools",
  "Plugins",
  "Agents",
  "Hooks",
];

/** Toggleable options per tab — rendered as a double-column [x]/[ ] matrix. */
const OPTIONS: Record<string, readonly string[]> = {
  General: [
    "English language",
    "Auto theme",
    "Notifications",
    "Verbose logging",
    "Confirm on quit",
    "Check updates",
  ],
  MCP: ["Enable MCP servers", "Allow remote tools", "Auto-reconnect", "Show MCP activity"],
  Skills: ["Code understanding", "File operations", "Command execution", "Verification"],
  Rules: ["Plan-mode read-only", "Approval gates", "Workspace boundary", "Token honesty"],
  Tools: ["Terminal execution", "File operations", "Search & grep", "Checkpoints"],
  Plugins: ["Theme support", "Custom filters", "Ruflo modules", "Auto-update"],
  Agents: ["Plan vs Act mode", "Loop detection", "Cost tracking", "Session logging"],
  Hooks: ["Cost tracking", "Session logging", "Pre-tool hooks", "Post-tool hooks"],
};

export interface SettingsModalProps {
  /** Close the overlay (Esc). */
  readonly onClose?: () => void;
  /** Tab selected on mount (defaults to General). */
  readonly initialTab?: number;
}

/**
 * Interactive /settings overlay (Ink).
 * ←/→ switch tabs · ↑/↓ move between options · Tab/Enter toggle · Esc exits.
 */
export default function SettingsModal({
  onClose,
  initialTab = 0,
}: SettingsModalProps): React.ReactElement {
  const { tokens } = useTheme();
  const [tabIdx, setTabIdx] = React.useState(() =>
    Math.min(Math.max(initialTab, 0), TABS.length - 1),
  );
  const [optIdx, setOptIdx] = React.useState(0);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});

  const tab = TABS[tabIdx] ?? "General";
  const options: readonly string[] = OPTIONS[tab] ?? [];
  const rowPairs: Array<readonly [string | undefined, string | undefined]> = [];
  for (let i = 0; i < options.length; i += 2) {
    rowPairs.push([options[i], options[i + 1]]);
  }

  useInput((_input, key) => {
    if (key.escape) {
      onClose?.();
      return;
    }
    if (key.leftArrow) {
      setTabIdx((i) => (i - 1 + TABS.length) % TABS.length);
      setOptIdx(0);
      return;
    }
    if (key.rightArrow) {
      setTabIdx((i) => (i + 1) % TABS.length);
      setOptIdx(0);
      return;
    }
    if (options.length === 0) return;
    if (key.upArrow) {
      setOptIdx((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setOptIdx((i) => (i + 1) % options.length);
      return;
    }
    if (key.tab || key.return) {
      const name = options[optIdx];
      if (name !== undefined) {
        const flag = `${tab}:${name}`;
        setChecked((prev) => ({ ...prev, [flag]: !prev[flag] }));
      }
    }
  });

  return (
    <Box borderStyle="round" borderColor={tokens.primary} flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={tokens.text}>
          ⚙ Settings
        </Text>
        <Text dimColor> ←/→ tabs · ↑/↓ options · Tab/Enter toggle · Esc close</Text>
      </Box>
      <Box flexDirection="row" marginBottom={1}>
        {TABS.map((label, i) => (
          <Box key={label} marginRight={1} flexShrink={0}>
            <Text
              bold={i === tabIdx}
              color={i === tabIdx ? tokens.textInverted : tokens.textMuted}
              backgroundColor={i === tabIdx ? tokens.primary : undefined}
              wrap="truncate"
            >
              {`[${label}]`}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        {rowPairs.map((pair, r) => (
          <Box key={`${tab}-${r}`} flexDirection="row">
            {pair.map((label, c) =>
              label === undefined ? (
                <Box key={`empty-${c}`} width={34} flexShrink={0} />
              ) : (
                <Box key={`opt-${c}`} width={34} flexShrink={0}>
                  <Text
                    color={r * 2 + c === optIdx ? tokens.textInverted : tokens.text}
                    backgroundColor={r * 2 + c === optIdx ? tokens.accent : undefined}
                    wrap="truncate"
                  >
                    {`${checked[`${tab}:${label}`] === true ? "[x]" : "[ ]"} ${label}`}
                  </Text>
                </Box>
              ),
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}