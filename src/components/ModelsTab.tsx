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
  // Return the oldest (earliest) timestamp
  return timestamps.sort()[0];
}

export interface ModelsTabProps {
  readonly models: readonly ModelDescriptor[];
  /** Currently active model stored in config (renders the [*] marker). */
  readonly activeModel: string;
  readonly activeProviderId: string;
  readonly loading?: boolean;
  /** Rows visible in the list viewport (defaults to a terminal-height fit). */
  readonly visibleRows?: number;
  /** True when this tab is the foreground overlay (owned/active modal). */
  readonly isActive?: boolean;
  /** Enter: persist the picked model + its provider, then close. */
  readonly onCommit: (modelId: string, providerId: string) => void;
  /** Esc / empty-state Enter: close without saving. */
  readonly onClose: () => void;
}

/** Subsequence fuzzy match across id, display name, and provider metadata. */
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
  /** Index into providerFilters ("All" first). Tab cycles it inline. */
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

  // Keep the cursor inside the list as the filter/search results change.
  React.useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const visibleRows = props.visibleRows ?? 10;
  const start = Math.min(scrollOffset, Math.max(filtered.length - visibleRows, 0));
  const visible = filtered.slice(start, start + visibleRows);
  const above = start;
  const below = Math.max(filtered.length - (start + visibleRows), 0);

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
        props.onClose(); // empty guard: Enter goes back to add a key
        return;
      }
      const picked = filtered[index];
      if (picked) props.onCommit(picked.id, picked.providerId);
      return;
    }
    // NOTE: printable text and backspace are owned exclusively by the focused
    // <TextInput> above — they must NOT be handled here, or every keystroke
    // would apply twice (double input capture).
  }, { isActive: props.isActive ?? true });

  // Keep the selection marker aligned with scroll when index moves.
  React.useEffect(() => {
    if (index < scrollOffset) setScrollOffset(index);
    else if (index >= scrollOffset + visibleRows) setScrollOffset(index - visibleRows + 1);
  }, [index, scrollOffset, visibleRows]);

  const statusLine = providerFilters.length > 1
    ? "Tab to change provider"
    : "";

  // Check if any models are fallback (cached) data
  const fallbackActive = hasFallbackModels(props.models);
  const fallbackTimestamp = getFallbackTimestamp(props.models);

  return (
    <Box width="100%" justifyContent="center" alignItems="center">
      <Box borderStyle="round" borderColor={tokens.border} flexDirection="column" paddingX={2} paddingY={1} width={78}>
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>Provider: {activeProviderName}</Text>
          {providerFilters.length > 1 ? (
            <Text dimColor>(tab to change provider)</Text>
          ) : null}
        </Box>
        <Box height={1} />
        <Box paddingX={1}>{statusLine ? <Text dimColor>{statusLine}</Text> : <Text> </Text>}</Box>

        {fallbackActive && (
          <Box marginY={1} paddingX={1} paddingY={1} backgroundColor={tokens.warning}>
            <Text bold color="black">[!] Offline Mode â€” Showing cached model catalog (may be stale)</Text>
            {fallbackTimestamp && (
              <Text color={tokens.textInverted}>  Fallback data from: {new Date(fallbackTimestamp).toLocaleString()}</Text>
            )}
          </Box>
        )}

        {props.models.length === 0 && !props.loading ? (
          <Box flexDirection="column" paddingX={1} paddingY={1}>
            <Text bold color={tokens.warning}>
              [!] No configured providers found. Run /settings or press Enter to add an API key.
            </Text>
            <Box height={1} />
            <Text dimColor>Press Enter or Esc to go back.</Text>
          </Box>
        ) : (
          <>
            <Box marginY={1} paddingX={1}>
              <Box borderStyle="single" borderColor={tokens.border} paddingX={1} paddingY={0} width="100%">
                <TextInput
                  focus={true}
                  value={query}
                  onChange={setQuery}
                  placeholder="Type to search models..."
                />
              </Box>
            </Box>
            <Box flexDirection="column" paddingX={1}>
              {above > 0 && <Text dimColor>▲ {above} more</Text>}
              {visible.map((m, i) => {
                const isActive = start + i === index;
                const isCurrent = m.id === props.activeModel && m.providerId === props.activeProviderId;
                const quota = getQuota(m.providerId, m.id);
                const isExhausted = quota?.isExhausted ?? false;
                // Exhausted models are shown but dimmed and skipped during navigation.
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
              {below > 0 && <Text dimColor>▼ {below} more</Text>}
              {filtered.length === 0 && <Text dimColor>No models match "{query}".</Text>}
            </Box>
          </>
        )}

        <Box height={1} />
        <Box paddingX={1}>
          <Text dimColor>
            Type to search, ↑/↓ navigate, Enter to select, Tab to change provider, Esc to close
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

/** Render a compact quota badge from a QuotaState:
 *   - Not configured (null)                 â†’ "" (nothing)
 *   - Normal (>20% remaining tokens)        â†’ dim-green "[85% quota]"
 *   - Low (<=20% remaining, not exhausted)  â†’ yellow "[12k tokens left]"
 *   - Exhausted (0 tokens / 429 active)     â†’ red bold "[EXHAUSTED]"
 */
function renderQuotaBadge(quota: import("../models/quota-tracker.js").QuotaState | null, isActive: boolean): string {
  if (!quota) return "";
  if (quota.isExhausted) return "[EXHAUSTED]";

  const rem = quota.remainingTokens;
  const lim = quota.limitTokens;

  if (rem == null || lim == null) {
    // Only requests remaining â€” show them as a plain count if present.
    if (quota.remainingRequests != null) return `[${quota.remainingRequests} calls left]`;
    return "";
  }

  if (lim <= 0) return "";

  const ratio = rem / lim; // 0..1
  if (ratio <= 0.2) {
    // Low tier: show absolute remaining tokens.
    return `[${formatTokenCount(rem)} tokens left]`;
  }
  // Normal tier: show remaining percentage.
  const pct = Math.round(ratio * 100);
  return `[${pct}% quota]`;
}

