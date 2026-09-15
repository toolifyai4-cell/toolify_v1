import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { DIM, RESET, GREEN, BLUE_BRIGHT, YELLOW, CYAN, RED } from "./ChatUI.js";
import type { ToolifyConfig } from "../cli/run.js";
import type { AuthUser } from "../auth/types.js";

export interface MenuScreenProps {
  readonly userName: string;
  readonly user: AuthUser;
  readonly config: ToolifyConfig;
  readonly usage: { inputTokens: number; outputTokens: number; costUsd: number };
  readonly history: Array<{ role: "user" | "assistant"; preview: string; ts: number }>;
  readonly onEnter: () => void;
  readonly onEsc: () => void;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  return "$" + usd.toFixed(4);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function MenuScreen(props: MenuScreenProps): React.ReactElement {
  const [tip, setTip] = React.useState(0);
  const [section, setSection] = React.useState<"home" | "providers" | "history" | "models" | "usage">("home");
  // Ink only sets a WIDTH on the root node, so percentage heights never
  // resolve; read the real terminal rows to pin the footer to the bottom.
  // Guard the fallback so a missing/zero row count can't collapse the layout
  // and leave the input bar floating at the top.
  const { rows } = useWindowSize();
  const height = typeof rows === "number" && rows > 0 ? rows : 24;

  useInput((ch, key) => {
    if (key.escape) {
      if (section === "home") props.onEsc();
      else setSection("home");
      return;
    }
    if (key.return) { props.onEnter(); return; }
    if (typeof ch === "string" && ch.length === 1) {
      const c = ch.toLowerCase();
      if (c === "p") setSection("providers");
      else if (c === "h") setSection("history");
      else if (c === "m") setSection("models");
      else if (c === "u") setSection("usage");
      else if (c === "/" || c === "0") setSection("home");
      return;
    }
    if (typeof ch === "string" && /^[1-4]$/.test(ch)) {
      const map: Record<string, "providers" | "history" | "models" | "usage"> = {
        "1": "providers", "2": "history", "3": "models", "4": "usage",
      };
      setSection(map[ch]);
    }
  });

  React.useEffect(() => {
    const t = setInterval(() => setTip((i) => i + 1), 3000);
    return () => clearInterval(t);
  }, []);

  const providerLabel = props.config.provider === "openai"
    ? "OpenAI"
    : props.config.provider === "deepseek"
    ? "DeepSeek"
    : props.config.provider === "anthropic"
    ? "Anthropic"
    : props.config.provider === "openrouter"
    ? "OpenRouter"
    : props.config.provider === "omniroute"
    ? "OmniRoute"
    : props.config.provider === "unoroute"
    ? "UnoRoute"
    : props.config.provider === "ollama"
    ? "Ollama"
    : props.config.provider === "litellm"
    ? "LiteLLM"
    : props.config.provider === "gemini"
    ? "Google Gemini"
    : props.config.provider === "mock"
    ? "Mock (offline)"
    : props.config.provider;

  const authLabel = props.user.provider === "google" ? "Google"
    : props.user.provider === "github" ? "GitHub"
    : props.user.provider;

  const authColor = props.user.provider === "google" ? BLUE_BRIGHT
    : props.user.provider === "github" ? CYAN
    : YELLOW;

  const tips = [
    "↑↓ to navigate · Enter to select · Esc to close",
    "Providers shows your auth + model configuration",
    "History shows recent conversation turns",
    "Models shows the current model + how to switch",
    "Usage shows token consumption and cost",
  ];

  const menuItems: Array<{ label: string; value: string; desc: string }> = [
    { label: "Providers", value: "providers", desc: "Auth + model configuration" },
    { label: "History", value: "history", desc: "Recent conversation turns" },
    { label: "Models", value: "models", desc: "Current model + switch provider" },
    { label: "Usage", value: "usage", desc: "Token consumption and cost" },
    { label: "Clear", value: "clear", desc: "Clear current conversation" },
    { label: "Exit", value: "exit", desc: "Quit TOOLIFY" },
  ];

  const [selected, setSelected] = React.useState(0);

  useInput((ch, key) => {
    if (key.escape) {
      if (section === "home") props.onEsc();
      else setSection("home");
      return;
    }
    if (key.return) {
      if (section === "home") {
        const item = menuItems[selected];
        if (item.value === "exit") props.onEsc();
        else if (item.value === "clear") props.onEnter();
        else setSection(item.value as "providers" | "history" | "models" | "usage");
      } else {
        props.onEnter();
      }
      return;
    }
    if (key.upArrow) { setSelected((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setSelected((s) => Math.min(menuItems.length - 1, s + 1)); return; }
  });

  // Render based on active section.
  switch (section) {
    case "providers":
      return (
        <Box flexDirection="column" height={height}>
          <Box paddingX={2} paddingY={1}>
            <Text bold>{`${CYAN}Settings — Providers${RESET}`}</Text>
          </Box>
          <Box paddingX={2} flexDirection="column">
            <Text bold>Auth</Text>
            <Text>{authColor}●{RESET} Signed in with {authLabel} as {props.user.name}</Text>
            <Text>{DIM}   id: {props.user.id}{RESET}</Text>
            {props.user.email ? <Text>{DIM}   email: {props.user.email}{RESET}</Text> : null}
            <Box height={1} />
            <Text bold>Model provider</Text>
            <Text>{GREEN}●{RESET} {providerLabel}</Text>
            <Text>{DIM}   model: {props.config.model}{RESET}</Text>
            <Text>{DIM}   baseUrl: {props.config.baseUrl}{RESET}</Text>
            <Box height={1} />
            <Text>{DIM}Press ESC to return home · Enter to close menu{RESET}</Text>
          </Box>
          <Box flexGrow={1} />
          <Box paddingX={2}><Text dimColor>{tips[tip % tips.length]}</Text></Box>
        </Box>
      );

    case "history":
      return (
        <Box flexDirection="column" height={height}>
          <Box paddingX={2} paddingY={1}>
            <Text bold>{`${CYAN}Settings — History${RESET}`}</Text>
          </Box>
          <Box paddingX={2} flexDirection="column" flexGrow={1} overflow="hidden">
            {props.history.length === 0 ? (
              <Text dimColor>No history yet. Start chatting to build your log.</Text>
            ) : (
              props.history.slice(-12).map((h, i) => (
                <Text key={i}>
                  {h.role === "user" ? GREEN + "You" + RESET : CYAN + "Toolify" + RESET}{" "}
                  {DIM}{fmtTime(h.ts)}{RESET}{" "}
                  {h.preview.slice(0, 80)}{h.preview.length > 80 ? "..." : ""}
                </Text>
              ))
            )}
          </Box>
          <Box paddingX={2}><Text dimColor>{tips[tip % tips.length]}</Text></Box>
        </Box>
      );

    case "models":
      return (
        <Box flexDirection="column" height={height}>
          <Box paddingX={2} paddingY={1}>
            <Text bold>{`${CYAN}Settings — Models${RESET}`}</Text>
          </Box>
          <Box paddingX={2} flexDirection="column">
            <Text bold>Current model</Text>
            <Text>{GREEN}●{RESET} {props.config.model}</Text>
            <Text>{DIM}   provider: {providerLabel}{RESET}</Text>
            <Text>{DIM}   baseUrl: {props.config.baseUrl}{RESET}</Text>
            <Box height={1} />
            <Text bold>Switch provider</Text>
            <Text>{DIM}Restart the wizard with a different provider to change this:{RESET}</Text>
            <Text>{" "}  {CYAN}toolify{RESET} {DIM}(run from any workspace to re-open onboarding){RESET}</Text>
          </Box>
          <Box flexGrow={1} />
          <Box paddingX={2}><Text dimColor>{tips[tip % tips.length]}</Text></Box>
        </Box>
      );

    case "usage":
      return (
        <Box flexDirection="column" height={height}>
          <Box paddingX={2} paddingY={1}>
            <Text bold>{`${CYAN}Settings — Usage${RESET}`}</Text>
          </Box>
          <Box paddingX={2} flexDirection="column">
            <Text bold>This session</Text>
            <Text>{" "}Input tokens:  {GREEN}{fmtTokens(props.usage.inputTokens)}{RESET}</Text>
            <Text>{" "}Output tokens: {GREEN}{fmtTokens(props.usage.outputTokens)}{RESET}</Text>
            <Text>{" "}Total cost:    {YELLOW}{fmtCost(props.usage.costUsd)}{RESET}</Text>
            <Box height={1} />
            <Text bold>Lifetime</Text>
            <Text dimColor>  Aggregated usage is tracked per-workspace.</Text>
          </Box>
          <Box flexGrow={1} />
          <Box paddingX={2}><Text dimColor>{tips[tip % tips.length]}</Text></Box>
        </Box>
      );

    case "home":
    default:
      return (
        <Box flexDirection="column" height={height}>
          <Box paddingX={2} paddingY={1}>
            <Text bold>{`${CYAN}Settings — Menu${RESET}`}</Text>
          </Box>
          <Box paddingX={2} flexDirection="column">
            <Text>Welcome back, {GREEN}{props.userName}{RESET}.</Text>
            <Box height={1} />
            <Text bold>Commands</Text>
            {menuItems.map((item, i) => (
              <Text key={item.value}>
                {i === selected ? `${CYAN}❯ ${item.label}${RESET}` : `${DIM}  ${item.label}${RESET}`}
                {"  "}{DIM}{item.desc}{RESET}
              </Text>
            ))}
            <Box height={1} />
            <Text>{DIM}↑↓ navigate · Enter select · Esc close{RESET}</Text>
          </Box>
          <Box flexGrow={1} />
          <Box paddingX={2}><Text dimColor>{tips[tip % tips.length]}</Text></Box>
        </Box>
      );
  }
}