import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/ThemeContext.js";
import { HistoryModal } from "./HistoryModal.js";

export interface SlashModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
}

/**
 * Centered, double-line bordered overlay for slash-command detail views
 * (`/account`, `/help`, `/usage`). Esc closes; the modal owns its own input
 * listener so keys don't bleed into the chat input below.
 */
export function SlashModal({
  isOpen,
  title,
  onClose,
  children,
  footer,
}: SlashModalProps): React.ReactElement | null {
  const { tokens } = useTheme();

  useInput(
    (_input, key) => {
      if (key.escape) {
        onClose();
      }
    },
    { isActive: isOpen },
  );

  if (!isOpen) return null;

  // Special case for /history command - render HistoryModal instead
  if (title === 'History') {
    return (
      <HistoryModal 
        isOpen={isOpen}
        history={[]}
        onClose={onClose}
      />
    );
  }

  return (
    <Box width="100%" height="100%" justifyContent="center" alignItems="center">
      <Box
        borderStyle="double"
        borderColor={tokens.primary}
        flexDirection="column"
        paddingX={3}
        paddingY={1}
        width={64}
        maxWidth="90%"
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>
            {title}
          </Text>
          <Text dimColor>[Esc] Close</Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="column" paddingX={1}>
          {children}
        </Box>
        <Box flexGrow={1} />
        {footer ? (
          <Box paddingX={1}>
            {footer}
          </Box>
        ) : (
          <Box paddingX={1}>
            <Text dimColor>↑/↓ navigate · Enter select · Esc close</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** Reusable styled row used inside slash modals. */
export function SlashModalRow({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}): React.ReactElement {
  const { tokens } = useTheme();
  return (
    <Box flexDirection="row">
      <Box width={18} flexShrink={0}>
        <Text bold color={color ?? tokens.primary}>
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text>{value}</Text>
      </Box>
    </Box>
  );
}

/** Section heading for slash modal content. */
export function SlashModalSection({
  title,
  color,
  children,
}: {
  readonly title: string;
  readonly color?: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { tokens } = useTheme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={color ?? tokens.primary}>
        {title}
      </Text>
      <Box height={1} />
      {children}
    </Box>
  );
}