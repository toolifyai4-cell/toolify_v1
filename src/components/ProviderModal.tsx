import React from "react";
import { Box, Text, useInput } from "ink";
import type { SettingsProvider } from "./settings.js";

export interface ProviderCatalogEntry {
  readonly id: SettingsProvider;
  readonly name: string;
  readonly category: string;
  readonly defaultModel: string;
  readonly isCurrent: boolean;
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
  { id: "anthropic", name: "Anthropic", category: "Popular & Direct", defaultModel: "claude-3-5-sonnet-20241022", isCurrent: false },
  { id: "openai", name: "OpenAI", category: "Popular & Direct", defaultModel: "gpt-4o", isCurrent: false },
  { id: "gemini", name: "Google Gemini", category: "Popular & Direct", defaultModel: "gemini-1.5-pro", isCurrent: false },
  { id: "groq", name: "Groq", category: "Popular & Direct", defaultModel: "llama-3.3-70b-versatile", isCurrent: false },
  // Cloud Aggregators
  { id: "openrouter", name: "OpenRouter", category: "Cloud Aggregators", defaultModel: "anthropic/claude-3.5-sonnet", isCurrent: false },
  { id: "perplexity", name: "Perplexity AI", category: "Cloud Aggregators", defaultModel: "sonar-pro", isCurrent: false },
  // Local Gateways & Routers
  { id: "omniroute", name: "OmniRoute", category: "Local Gateways & Routers", defaultModel: "auto", isCurrent: false },
  { id: "unoroute", name: "UnoRoute", category: "Local Gateways & Routers", defaultModel: "auto", isCurrent: false },
  { id: "litellm", name: "LiteLLM", category: "Local Gateways & Routers", defaultModel: "gpt-4o", isCurrent: false },
  // Local Runners
  { id: "ollama", name: "Ollama", category: "Local Runners", defaultModel: "llama3", isCurrent: false },
];

export const ProviderModal = (props: ProviderModalProps) => {
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
        borderColor="cyan"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={72}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color="cyan">Provider</Text>
          <Text dimColor>[Esc] Close</Text>
        </Box>
        <Box height={1} />
        <Box
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          paddingY={0}
          width="100%"
        >
          <Text>
            {query || <Text dimColor>Search providers...</Text>}
            {blink ? <Text color="cyan">█</Text> : <Text> </Text>}
          </Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="column" paddingX={1}>
          {visible.map((p, i) => {
            const isActive = scrollOffset + i === selected;
            return (
              <Box
                key={p.id}
                flexDirection="row"
                height={1}
                marginBottom={1}
                width="100%"
                backgroundColor={isActive ? "cyan" : undefined}
                paddingX={1}
              >
                <Box width={2} flexShrink={0}>
                  <Text bold color={isActive ? "black" : undefined}>
                    {isActive ? "▸ " : "  "}
                  </Text>
                </Box>
                <Box width={22} flexShrink={0}>
                  <Text bold color={isActive ? "black" : "white"}>{p.name.padEnd(22)}</Text>
                </Box>
                <Box flexShrink={0}>
                  {p.isCurrent && (
                    <Text bold color={isActive ? "black" : "green"}>• (current)</Text>
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