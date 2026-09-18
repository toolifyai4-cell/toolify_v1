import React from "react";
import { Box, Text, useInput } from "ink";
import type { SettingsProvider } from "./settings.js";
import { readConfigSync } from "../utils/config.js";
import { useTheme } from "../theme/ThemeContext.js";

export interface ProviderCatalogEntry {
  readonly id: SettingsProvider;
  readonly name: string;
  readonly category: string;
  readonly defaultModel: string;
  readonly isCurrent: boolean;
  /** Whether this provider has a valid API key configured in ~/.toolify/config.json */
  readonly isConfigured: boolean;
}

export interface ProviderModalProps {
  readonly providers: readonly ProviderCatalogEntry[];
  readonly currentIndex: number;
  readonly onSelect: (provider: SettingsProvider, defaultModel: string) => void;
  readonly onClose: () => void;
}

/** Static catalog of popular, direct, cloud-aggregator, gateway, and local providers. */
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  // Popular & Direct
  { id: "anthropic", name: "Anthropic", category: "Popular & Direct", defaultModel: "claude-3-5-sonnet-20241022", isCurrent: false, isConfigured: false },
  { id: "openai", name: "OpenAI", category: "Popular & Direct", defaultModel: "gpt-4o", isCurrent: false, isConfigured: false },
  { id: "gemini", name: "Google Gemini", category: "Popular & Direct", defaultModel: "gemini-2.5-pro", isCurrent: false, isConfigured: false },
  { id: "groq", name: "Groq", category: "Popular & Direct", defaultModel: "llama-3.3-70b-versatile", isCurrent: false, isConfigured: false },
  // Cloud Aggregators
  { id: "openrouter", name: "OpenRouter", category: "Cloud Aggregators", defaultModel: "anthropic/claude-3.5-sonnet", isCurrent: false, isConfigured: false },
  { id: "perplexity", name: "Perplexity AI", category: "Cloud Aggregators", defaultModel: "sonar-pro", isCurrent: false, isConfigured: false },
  // Local Gateways & Routers
  { id: "omniroute", name: "OmniRoute", category: "Local Gateways & Routers", defaultModel: "auto", isCurrent: false, isConfigured: false },
  { id: "unoroute", name: "UnoRoute", category: "Local Gateways & Routers", defaultModel: "auto", isCurrent: false, isConfigured: false },
  { id: "litellm", name: "LiteLLM", category: "Local Gateways & Routers", defaultModel: "gpt-4o", isCurrent: false, isConfigured: false },
  // Local Runners
  { id: "ollama", name: "Ollama", category: "Local Runners", defaultModel: "llama3.2", isCurrent: false, isConfigured: false },
];

/** Check if a provider has a configured API key (from config.json or env). */
function isProviderConfigured(providerId: SettingsProvider, workspace: string): boolean {
  try {
    const cfg = readConfigSync();
    const key = cfg.apiKeys[providerId];
    if (key && key.trim().length > 0) return true;
    // Also check environment variables
    const envVars: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gemini: "GEMINI_API_KEY",
      groq: "GROQ_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      perplexity: "PERPLEXITY_API_KEY",
      omniroute: "OMNIROUTE_API_KEY",
      unoroute: "UNOROUTE_API_KEY",
      litellm: "LITELLM_API_KEY",
      ollama: "OLLAMA_API_KEY",
    };
    const envVar = envVars[providerId];
    if (envVar && process.env[envVar]) return true;
  } catch {
    // Ignore errors, treat as unconfigured
  }
  return false;
}

export const ProviderModal = (props: ProviderModalProps) => {
  const { tokens } = useTheme();
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState(props.currentIndex);
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const [blink, setBlink] = React.useState(true);

  React.useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.providers;
    return props.providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [query, props.providers]);

  React.useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(filtered.length - 1, 0)));
    setScrollOffset(0);
  }, [filtered.length]);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected((s) => {
        const count = Math.max(filtered.length, 1);
        const next = (s - 1 + count) % count;
        if (count > 5 && next === count - 1) setScrollOffset(Math.max(count - 5, 0));
        else if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
      return;
    }
    if (key.downArrow) {
      setSelected((s) => {
        const count = Math.max(filtered.length, 1);
        const next = (s + 1) % count;
        if (next === 0) setScrollOffset(0);
        else if (next >= scrollOffset + 5) setScrollOffset(next - 4);
        return next;
      });
      return;
    }
    if (key.return) {
      const picked = filtered[selected];
      if (picked) props.onSelect(picked.id, picked.defaultModel);
      return;
    }
    if (key.escape) {
      props.onClose();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (typeof input === "string" && input.length > 0 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      return;
    }
  });

  const visible = filtered.slice(scrollOffset, scrollOffset + 5);
  const moreCount = Math.max(filtered.length - (scrollOffset + 5), 0);

  return (
    <Box width="100%" height={20} justifyContent="center" alignItems="center">
      <Box
        borderStyle="round"
        borderColor={tokens.border}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={78}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>Provider</Text>
          <Text dimColor>[Esc] Close</Text>
        </Box>
        <Box height={1} />
        <Box
          borderStyle="round"
          borderColor={tokens.border}
          paddingX={1}
          paddingY={0}
          width="100%"
        >
          <Text>
            {query || <Text dimColor>Search providers...</Text>}
            {blink ? <Text color={tokens.primary}>█</Text> : <Text> </Text>}
          </Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="column" paddingX={1}>
          {visible.map((p, i) => {
            const isActive = scrollOffset + i === selected;
            const statusBadge = p.isConfigured
              ? <Text bold color={isActive ? tokens.textInverted : tokens.success}>● Configured</Text>
              : <Text dimColor>○ Unconfigured</Text>;
            return (
              <Box
                key={p.id}
                flexDirection="row"
                height={1}
                marginBottom={1}
                width="100%"
                backgroundColor={isActive ? tokens.primary : undefined}
                paddingX={1}
              >
                <Box width={2} flexShrink={0}>
                  <Text bold color={isActive ? tokens.textInverted : undefined}>
                    {isActive ? "▸ " : "  "}
                  </Text>
                </Box>
                <Box width={22} flexShrink={0}>
                  <Text bold color={isActive ? tokens.textInverted : tokens.text}>{p.name.padEnd(22)}</Text>
                </Box>
                <Box width={16} flexShrink={0}>
                  {statusBadge}
                </Box>
                <Box flexShrink={0}>
                  {p.isCurrent && (
                    <Text bold color={isActive ? tokens.textInverted : tokens.success}>• (current)</Text>
                  )}
                </Box>
              </Box>
            );
          })}
          {visible.length === 0 && (
            <Text dimColor>No providers match "{query}"</Text>
          )}
        </Box>
        <Box height={1}>
          <Text dimColor>▼ {moreCount} more</Text>
        </Box>
        <Box height={1} />
        <Box paddingX={1}>
          <Text dimColor>{"↑/↓ navigate · Enter select · Esc close"}</Text>
        </Box>
      </Box>
    </Box>
  );
};