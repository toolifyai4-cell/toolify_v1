import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ModelDescriptor } from "../models/model-registry.js";
import { getQuota } from "../models/quota-tracker.js";
import { useTheme } from "../theme/ThemeContext.js";
import { formatTokenCount } from "./ChatUI.js";

/** Check if any models in the list are fallback (cached/offline) data. */
function hasFallbackModels(models: readonly ModelDescriptor[]): boolean {
  return models.some((m) => m.isFallback === true);
}

/** Get the oldest fallback timestamp for display. */
function getFallbackTimestamp(models: readonly ModelDescriptor[]): string | undefined {
  const timestamps = models
    .filter((m) => m.isFallback && m.fetchedAt)
    .map((m) => m.fetchedAt!);
  if (timestamps.length === 0) return undefined;
  return timestamps.sort()[0];
}

export interface ModelsTabProps {
  readonly models: readonly ModelDescriptor[];
  readonly activeModel: string;
  readonly activeProviderId: string;
  readonly loading?: boolean;
  readonly visibleRows?: number;
  readonly isActive?: boolean;
  readonly onCommit: (modelId: string, providerId: string) => void;
  readonly onClose: () => void;
}

function fuzzyMatches(model: ModelDescriptor, query: string): boolean {
  const q = query.toLowerCase();
  if (!q) return true;
  const haystack = `${model.id} ${model.displayName} ${model.providerName} ${model.providerId}`
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "");
  let i = 0;
  for (const ch of q.replace(/[^a-z0-9.]+/g, "")) {
    i = haystack.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export const ModelsTab = (props: ModelsTabProps) => {
  const { tokens } = useTheme();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const [filterIdx, setFilterIdx] = React.useState(0);
  const [scrollOffset, setScrollOffset] = React.useState(0);

  const providerFilters = React.useMemo(() => {
    const ids: string[] = [];
    for (const m of props.models) {
      if (!ids.includes(m.providerId)) ids.push(m.providerId);
    }
    return ids.length > 1 ? ["All", ...ids] : ids;
  }, [props.models]);

  const filtered = React.useMemo(
    () =>
      props.models
        .filter((m) => fuzzyMatches(m, query))
        .filter((m) => {
          const filter = providerFilters[filterIdx];
          return !filter || filter === "All" || m.providerId === filter;
        }),
    [props.models, query, providerFilters, filterIdx],
  );

  React.useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const visibleRows = props.visibleRows ?? 10;
  const start = Math.min(scrollOffset, Math.max(filtered.length - visibleRows, 0));
  const visible = filtered.slice(start, start + visibleRows);
  const above = start;
  const below = Math.max(filtered.length - (start + visibleRows), 0);

  const noMatch = filtered.length === 0;
  const fillerRows = Math.max(0, visibleRows - visible.length - (noMatch ? 1 : 0));

  const activeProviderName = props.models.find(m => m.providerId === props.activeProviderId)?.providerName ?? props.activeProviderId;

  useInput((input, key) => {
    if (key.escape) {
      props.onClose();
      return;
    }
    if (key.upArrow) {
      setIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      return;
    }
    if (key.tab && !key.shift) {
      if (providerFilters.length > 1) {
        setFilterIdx((f) => (f + 1) % providerFilters.length);
        setIndex(0);
        setScrollOffset(0);
      }
      return;
    }
    if (key.return) {
      if (props.models.length === 0 && !props.loading) {
        props.onClose();
        return;
      }
      const picked = filtered[index];
      if (picked) props.onCommit(picked.id, picked.providerId);
      return;
    }
  }, { isActive: props.isActive ?? true });

  React.useEffect(() => {
    if (index < scrollOffset) setScrollOffset(index);
    else if (index >= scrollOffset + visibleRows) setScrollOffset(index - visibleRows + 1);
  }, [index, scrollOffset, visibleRows]);

  const statusLine = providerFilters.length > 1 ? "Tab to change provider" : "";
  const fallbackActive = hasFallbackModels(props.models);
  const fallbackTimestamp = getFallbackTimestamp(props.models);

  return (
    <Box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        borderStyle="round"
        borderColor={tokens.border}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={65}
      >
        <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
          <Text bold color={tokens.primary}>Provider: {activeProviderName}</Text>
          {providerFilters.length > 1 ? (
            <Text dimColor>(tab to change provider)</Text>
          ) : null}
        </Box>
        <Box paddingX={1} flexShrink={0}>{statusLine ? <Text dimColor>{statusLine}</Text> : <Text> </Text>}</Box>

        {/* Fallback warning: Only render when active to eliminate dead space */}
        {fallbackActive && (
          <Box
            marginY={1}
            paddingX={1}
            paddingY={1}
            backgroundColor={tokens.warning}
            flexDirection="column"
            flexShrink={0}
          >
            <Text bold color="black">[!] Offline Mode — Showing cached model catalog (may be stale)</Text>
            {fallbackTimestamp && (
              <Text color={tokens.textInverted}>  Fallback data from: {new Date(fallbackTimestamp).toLocaleString()}</Text>
            )}
          </Box>
        )}

        {props.models.length === 0 && !props.loading ? (
          <Box flexDirection="column" flexShrink={0}>
            <Box flexDirection="column" paddingX={1} paddingY={1} justifyContent="flex-start">
              <Text bold color={tokens.warning}>
                [!] No configured providers found. Run /settings or press Enter to add an API key.
              </Text>
              <Box height={1} />
              <Text dimColor>Press Enter or Esc to go back.</Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" flexShrink={0} height={visibleRows + 7}>
            <Box marginY={1} paddingX={1}>
              <Box borderStyle="single" borderColor={tokens.border} paddingX={1} paddingY={0} width="100%">
                <TextInput
                  focus={true}
                  value={query}
                  onChange={setQuery}
                  placeholder=" Type to search models..."
                />
              </Box>
            </Box>
            <Box flexDirection="column" paddingX={1} flexShrink={0} height={visibleRows + 2} overflow="hidden">
              {above > 0 ? (
                <Text dimColor>▲ {above} more</Text>
              ) : (
                <Text> </Text>
              )}
              {visible.map((m, i) => {
                const isActive = start + i === index;
                const isCurrent = m.id === props.activeModel && m.providerId === props.activeProviderId;
                const quota = getQuota(m.providerId, m.id);
                const isExhausted = quota?.isExhausted ?? false;
                const effectiveActive = isActive && !isExhausted;
                const freeBadge = m.isFree ? " (free)" : "";
                const currentBadge = isCurrent && !isExhausted ? " [current]" : "";
                const tokenBadge = m.contextLimit !== "N/A" ? ` ${m.contextLimit}` : "";
                const label = `${m.displayName}${freeBadge}${tokenBadge}${currentBadge}`;
                return (
                  <Box
                    key={`${m.providerId}:${m.id}`}
                    height={1}
                    width="100%"
                    backgroundColor={effectiveActive ? tokens.primary : undefined}
                  >
                    <Box width={2} flexShrink={0}>
                      <Text bold color={effectiveActive ? tokens.textInverted : tokens.primary}>
                        {effectiveActive ? ">" : " "}
                      </Text>
                    </Box>
                    <Box flexShrink={1}>
                      <Text color={effectiveActive ? tokens.textInverted : undefined} wrap="truncate">
                        {label}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
              {below > 0 ? (
                <Text dimColor>▼ {below} more</Text>
              ) : (
                <Text> </Text>
              )}
              {filtered.length === 0 && <Text dimColor>No models match "{query}".</Text>}
              {Array.from({length: fillerRows}, () => <Text key={`f-${Math.random()}`}> </Text>)}
            </Box>
          </Box>
        )}

        <Box paddingX={1} height={2} flexShrink={0} marginTop={1}>
          <Text dimColor>
            Type to search, ↑/↓ navigate, Enter to select, Tab to change provider, Esc to close
          </Text>
        </Box>
      </Box>
    </Box>
  );
};