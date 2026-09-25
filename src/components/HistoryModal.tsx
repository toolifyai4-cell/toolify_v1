import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/ThemeContext.js";

export interface HistoryTurn {
  readonly role: "user" | "assistant";
  readonly preview: string;
  readonly ts: number;
}

export interface HistoryModalProps {
  readonly isOpen: boolean;
  readonly history: readonly HistoryTurn[];
  readonly onClose: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Centered popup containing the most recent conversation turns. */
export function HistoryModal({ isOpen, history, onClose }: HistoryModalProps): React.ReactElement | null {
  const { tokens } = useTheme();

  useInput((_input, key) => {
    if (key.escape) onClose();
  }, { isActive: isOpen });

  if (!isOpen) return null;

  return (
    <Box width="100%" height="100%" justifyContent="center" alignItems="center">
      <Box
        borderStyle="double"
        borderColor={tokens.primary}
        flexDirection="column"
        paddingX={3}
        paddingY={1}
        width={72}
        maxWidth="90%"
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>History</Text>
          <Text dimColor>[Esc] Close</Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
          {history.length === 0 ? (
            <Text dimColor>No history yet. Start chatting to build your log.</Text>
          ) : history.slice(-12).map((turn, index) => {
            const preview = turn.preview.length > 80 ? `${turn.preview.slice(0, 80)}...` : turn.preview;
            return (
              <Text key={`${turn.ts}-${index}`}>
                <Text bold color={turn.role === "user" ? tokens.primary : tokens.accent}>
                  {turn.role === "user" ? "You" : "Nexipi"}
                </Text>
                <Text dimColor> {formatTime(turn.ts)} </Text>
                <Text wrap="truncate">{preview}</Text>
              </Text>
            );
          })}
        </Box>
        <Box height={1} />
        <Box paddingX={1}><Text dimColor>Recent conversation turns · Esc close</Text></Box>
      </Box>
    </Box>
  );
}
