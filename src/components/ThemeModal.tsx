/** Fixed theme modal with scrollable pagination for 9 themes */
import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/ThemeContext.js";
import { THEME_LABELS } from "./settings.js";

export interface ThemeModalProps {
  /** Modal visibility — also gates `useInput` so keys don't bleed upstream. */
  readonly isOpen: boolean;
  /** Esc / cancel (close without further action). */
  readonly onClose: () => void;
}

/**
 * Interactive theme picker.
 *
 * Renders above the settings overlay. Up/Down move the cursor, Enter applies
 * the highlighted theme (persisting it to ~/.toolify/config.json via
 * `setTheme`) and closes, Esc closes without applying.
 *
 * Every color comes from the *currently active* theme tokens, so the modal
 * repaints in the new palette the instant a selection is committed.
 */
export function ThemeModal({ isOpen, onClose }: ThemeModalProps): React.ReactElement | null {
  const { theme, tokens, setTheme, availableThemes } = useTheme();

  const [selected, setSelected] = React.useState(() => {
    const idx = availableThemes.findIndex((t) => t.id === theme.id);
    return idx >= 0 ? idx : 0;
  });

  // Scrollable navigation support for 9+ themes
  const pageSize = 5; // Number of visible items in the modal view
  const [scrollOffset, setScrollOffset] = React.useState(0);

  // Update scroll offset when selection changes beyond visible window
  React.useEffect(() => {
    if (selected >= scrollOffset + pageSize) {
      setScrollOffset(selected - pageSize + 1);
    } else if (selected < scrollOffset) {
      setScrollOffset(selected);
    }
  }, [selected, scrollOffset]);

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        setSelected((s) => (s - 1 + availableThemes.length) % availableThemes.length);
        return;
      }
      if (key.downArrow) {
        setSelected((s) => (s + 1) % availableThemes.length);
        return;
      }
      if (key.return) {
        const picked = availableThemes[selected];
        if (picked) void setTheme(picked.id);
        onClose();
        return;
      }
    },
    { isActive: isOpen },
  );

  if (!isOpen) return null;

  const visibleThemes = availableThemes.slice(scrollOffset, scrollOffset + pageSize);
  const totalPages = Math.ceil(availableThemes.length / pageSize);

  return (
    <Box width="100%" height={20} justifyContent="center" alignItems="center">
      <Box
        borderStyle="round"
        borderColor={tokens.border}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={44}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>
            Select Theme
          </Text>
          <Text dimColor>[Esc] Close</Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="column" paddingX={1}>
          {visibleThemes.map((t, i) => {
            const globalIndex = scrollOffset + i;
            const isSelected = globalIndex === selected;
            const isCurrent = t.id === theme.id;
            return (
              <Box
                key={t.id}
                height={1}
                width="100%"
                backgroundColor={isSelected ? tokens.primary : undefined}
                paddingX={1}
              >
                <Box width={2} flexShrink={0}>
                  <Text bold color={isSelected ? tokens.textInverted : tokens.primary}>
                    {isSelected ? "▸ " : "  "}
                  </Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color={isSelected ? tokens.textInverted : tokens.text}>
                    {THEME_LABELS[t.id] ?? t.name}
                    {isCurrent ? " ● (current)" : ""}
                  </Text>
                </Box>
              </Box>
            );
          })}
          {/* Pagination controls when there are more themes than visible */}
          {availableThemes.length > pageSize && totalPages > 1 && (
            <Box height={1} paddingX={1}>
              <Text dimColor>
                {scrollOffset > 0 && " + " + scrollOffset} "/" {totalPages} pages{availableThemes.length - scrollOffset - pageSize > 0 && " + " + (availableThemes.length - scrollOffset - pageSize)} down
                availableThemes.length - scrollOffset - pageSize > 0 && " + " +
                availableThemes.length - scrollOffset - pageSize
              
              </Text>
            </Box>
          )}
        </Box>
        <Box height={1} />
        <Box paddingX={1}>
          <Text dimColor>
            ↑/↓ navigate · Enter select · Esc close{" "}
            {totalPages > 1 && "page " + (Math.floor(scrollOffset / pageSize) + 1) + " of " + totalPages}}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

{availableThemes.length > pageSize && totalPages > 1 && (
            <Box height={1} paddingX={1}>
              <Text dimColor>
                {scrollOffset > 0 && " +" + scrollOffset}  {"/"}  {totalPages} pages{availableThemes.length - scrollOffset - pageSize > 0 && " + " + (availableThemes.length - scrollOffset - pageSize)} down
              </Text>
            </Box>
          )}