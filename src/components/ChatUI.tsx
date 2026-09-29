import React, { useMemo, useState } from "react";
import { Box, Text, useCursor, useInput, useStdout } from "ink";
import type { AgentMode, ToolCall } from "../agent/types.js";
import { CommandMenu, filterSlashCommands } from "./CommandMenu.js";
import { MarkdownText } from "./MarkdownText.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { ModelsTab } from "./ModelsTab.js";
import type { ModelDescriptor } from "../models/model-registry.js";
import type { SettingsDraft } from "./settings.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ callId: string; content: string; isError?: boolean }>;
  /** True while this assistant bubble is a live placeholder awaiting tokens. */
  thinking?: boolean;
}

export interface StatusInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  turnCount: number;
  /** Current provider's remaining token quota (from last response headers). */
  remainingTokens?: number;
  /** Provider token limit (from last response headers). */
  limitTokens?: number;
  /** Whether the current provider/model is rate-limited / exhausted. */
  isExhausted?: boolean;
  /** Reset countdown string (e.g. "45s", "3m"). */
  resetTime?: string;
}

export interface ChatUIProps {
  messages: ChatMessage[];
  status: StatusInfo;
  mode: AgentMode;
  autoApprove: "off" | "writes" | "all";
  workspace: string;
  isRunning: boolean;
  onSubmit: (input: string) => void;
  onModeToggle: () => void;
  onAutoApproveToggle: () => void;
  onClear: () => void;
  onExit: () => void;
  onCancel: () => void;
  /** When true the settings overlay owns the screen (hides prompt). */
  readonly settingsOpen?: boolean;
  /** Live settings snapshot shown in the overlay. */
  readonly settingsInitial?: SettingsDraft;
  /** Esc in the overlay: persist draft to .toolify/config.json + close. */
  readonly onSettingsSave?: (draft: SettingsDraft) => void;
  /** Live sync: Mode toggled inside the settings overlay. */
  readonly onSettingsModeChange?: (mode: AgentMode) => void;
  /** Live sync: Auto-Approve cycled inside the settings overlay. */
  readonly onSettingsAutoApproveChange?: (autoApprove: "off" | "writes" | "all") => void;
  /** Session dir (events.jsonl) feeding live Ponytail metrics. */
  readonly settingsSessionDir?: string | null;
  /** Live token totals used by the Plugins tab metric fallback. */
  readonly settingsUsage?: { readonly inputTokens: number; readonly outputTokens: number };
  /** When true the /models picker overlay owns the screen. */
  readonly modelsOpen?: boolean;
  /** Aggregated models from all configured providers (null while probing). */
  readonly models?: readonly ModelDescriptor[] | null;
  readonly modelsLoading?: boolean;
  readonly activeModel?: string;
  readonly activeProviderId?: string;
  /** Enter in the picker: persist model+provider and close. */
  readonly onModelsCommit?: (modelId: string, providerId: string) => void;
  /** Esc in the picker: close without saving. */
  readonly onModelsClose?: () => void;
}

export const DIM = "\x1b[2m";
export const CYAN = "\x1b[36m";
export const GREEN = "\x1b[32m";
export const GREEN_BRIGHT = "\x1b[92m";
export const BLUE = "\x1b[34m";
export const BLUE_BRIGHT = "\x1b[94m";
export const YELLOW = "\x1b[33m";
export const YELLOW_BRIGHT = "\x1b[93m";
export const WHITE = "\x1b[37m";
export const RED = "\x1b[31m";
export const RESET = "\x1b[0m";

/** Round mode markers. Written as escapes so this source file stays pure ASCII. */
export const BALL_ACTIVE = "\u25cf";
export const BALL_IDLE = "\u25cb";

/** Compact token-count label: 1_500_000 -> "1.5M", 150_000 -> "150K", 42 -> "42". */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

/** Returns true when a message content string is a system banner (error/timeout/cancelled)
 * rather than a normal assistant response. Such banners are rendered as standalone
 * colored boxes instead of being prefixed with the [AGENT] label. */
export function isErrorBanner(content: string): boolean {
  return (
    content.startsWith("[ERROR]") ||
    content.startsWith("[TIMEOUT]") ||
    content.startsWith("[CANCELLED]")
  );
}

/**
 * Render a single chat message's content (role label + markdown + tool calls/results).
 */
function renderMessageContent(m: ChatMessage): React.ReactNode {
  return (
    <>
      {m.role === "user" ? (
        <Box flexDirection="column">
          <Text>
            <Text backgroundColor="blue" color="black" bold> YOU </Text>
          </Text>
          <MarkdownText content={m.content} />
        </Box>
      ) : isErrorBanner(m.content) ? (
        <Text color={m.content.startsWith("[TIMEOUT]") ? "yellow" : "red"}>{m.content}</Text>
      ) : (
        <Box flexDirection="column">
          <Text>
            {m.content && (
              <Text backgroundColor="magenta" color="black" bold>
                {" "}NEXIPI{" "}
              </Text>
            )}
          </Text>
          {m.content ? (
            <MarkdownText content={m.content} />
          ) : null}
        </Box>
      )}

      {m.toolCalls && m.toolCalls.length > 0 && (
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginLeft={1}
          marginTop={1}
          flexDirection="column"
        >
          {m.toolCalls.map((tc) => (
            <Text key={tc.id} dimColor>
              {"[TOOL] "}{tc.name} {" "}{JSON.stringify(tc.input).slice(0, 120)}
            </Text>
          ))}
        </Box>
      )}

      {m.toolResults && m.toolResults.length > 0 && (
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginLeft={1}
          marginTop={1}
          flexDirection="column"
        >
          {m.toolResults.map((r) => (
            <Text key={r.callId} color={r.isError ? "red" : "blueBright"}>
              {r.isError ? "[error]" : "[result]"} {r.content.slice(0, 200)}
            </Text>
          ))}
        </Box>
      )}
    </>
  );
}

export const ChatUI = (props: ChatUIProps) => {
  useCursor();
  const { stdout } = useStdout();
  
  React.useEffect(() => {
    stdout.write("\x1B[?25l");
    return () => { stdout.write("\x1B[?25h"); };
  }, [stdout]);

  const height =
    typeof stdout.rows === "number" && stdout.rows > 0 ? stdout.rows : 24;

  const [inputValue, setInputValue] = React.useState("");
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const slashQuery = slashOpen && inputValue.startsWith("/") ? inputValue.slice(1) : "";
  const slashCommands = React.useMemo(
    () => (slashOpen ? filterSlashCommands(slashQuery) : []),
    [slashOpen, slashQuery],
  );

  const closeSlashMenu = React.useCallback(() => {
    setSlashOpen(false);
    setSlashIndex(0);
  }, []);

  React.useEffect(() => {
    if (slashOpen) setSlashIndex((i) => Math.min(i, Math.max(slashCommands.length - 1, 0)));
  }, [slashOpen, slashCommands.length]);

  const [blink, setBlink] = React.useState(true);
  React.useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, []);

  const settingsActive = props.settingsOpen === true && typeof props.onSettingsSave === "function" && props.settingsInitial !== undefined;
  const modelsActive = props.modelsOpen === true && typeof props.onModelsCommit === "function";

  useInput((ch, key) => {
    if (props.settingsOpen === true || props.modelsOpen === true) return;

    if (ch === "\x1f" || (key.ctrl && key.shift && key.backspace)) {
      props.onExit();
      return;
    }

    if (key.pageUp || (key.shift && key.upArrow)) {
      setScrollOffset((prev) => Math.min(prev + 3, Math.max(0, props.messages.length - 1)));
      return;
    }
    if (key.pageDown || (key.shift && key.downArrow)) {
      setScrollOffset((prev) => Math.max(0, prev - 3));
      return;
    }

    if (key.tab && key.shift) { props.onAutoApproveToggle(); return; }
    if (key.tab && !slashOpen) { if (!props.isRunning) props.onModeToggle(); return; }
    if (key.escape) {
      if (slashOpen) { closeSlashMenu(); return; }
      props.onCancel();
      return;
    }
    if (slashOpen && slashCommands.length > 0 && (key.upArrow || key.downArrow)) {
      setSlashIndex((i) => key.upArrow
        ? (i - 1 + slashCommands.length) % slashCommands.length
        : (i + 1) % slashCommands.length);
      return;
    }
    if (slashOpen && slashCommands.length > 0 && (key.return || key.tab)) {
      const picked = slashCommands[Math.min(slashIndex, slashCommands.length - 1)];
      if (picked) {
        setInputValue("");
        closeSlashMenu();
        props.onSubmit(picked.name);
        return;
      }
      closeSlashMenu();
      return;
    }
    if (props.isRunning) return;
    if (key.return) {
      const v = inputValue.trim();
      if (v) { setInputValue(""); props.onSubmit(v); }
      return;
    }
    if (key.delete || key.backspace) {
      setInputValue((prev) => {
        const next = prev.slice(0, -1);
        if (!next.startsWith("/")) closeSlashMenu();
        else setSlashIndex(0);
        return next;
      });
      return;
    }
    if (typeof ch === "string" && ch.length === 1 && !key.ctrl && !key.meta) {
      setInputValue((prev) => {
        const next = prev + ch;
        if (next.startsWith("/") && !props.isRunning) {
          if (!slashOpen) { setSlashOpen(true); setSlashIndex(0); }
          else setSlashIndex(0);
        } else if (slashOpen) {
          closeSlashMenu();
        }
        return next;
      });
      return;
    }
  });

  const isChatView = !modelsActive && !settingsActive;
  const showThinking =
    isChatView &&
    (props.isRunning ||
      props.messages.some(
        (m) => m.thinking && m.role === "assistant",
      ) ||
      props.messages.some((m) => m.content === "..."));

  // HARD-CODED ROW BUDGET: 6 rows total for Bottom Panel
  const BOTTOM_PANEL_HEIGHT = 6;
  const availableChatRows = Math.max(1, height - BOTTOM_PANEL_HEIGHT);

  // Filter messages to prevent terminal viewport scrollbar from swallowing the UI
  const visibleMessages = useMemo(() => {
    if (props.messages.length === 0) return [];
    const maxVisible = Math.max(1, availableChatRows - 2);
    const startIndex = Math.max(0, props.messages.length - maxVisible - scrollOffset);
    const endIndex = Math.min(props.messages.length, startIndex + maxVisible);
    return props.messages.slice(startIndex, endIndex);
  }, [props.messages, availableChatRows, scrollOffset]);

  return (
    <Box flexDirection="column" height={height}>
      {/* 1. CHAT MESSAGES AREA (STRICT BOUNDED HEIGHT) */}
      <Box flexDirection="column" height={availableChatRows} overflow="hidden">
        {modelsActive ? (
          <ModelsTab
            models={props.models ?? []}
            activeModel={props.activeModel ?? ""}
            activeProviderId={props.activeProviderId ?? ""}
            loading={props.modelsLoading}
            onCommit={props.onModelsCommit!}
            onClose={props.onModelsClose ?? (() => {})}
          />
        ) : settingsActive && props.settingsInitial !== undefined && typeof props.onSettingsSave === "function" ? (
          <SettingsMenu
            initial={props.settingsInitial}
            onSave={props.onSettingsSave}
            onModeChange={props.onSettingsModeChange}
            onAutoApproveChange={props.onSettingsAutoApproveChange}
            workspace={props.workspace}
            sessionDir={props.settingsSessionDir}
            usage={props.settingsUsage}
          />
        ) : (
          <>
            {props.messages.length === 0 && !props.isRunning && (
              <Box paddingTop={2}>
                <Text>{CYAN}What can I do for you?{RESET}</Text>
              </Box>
            )}
            
            {visibleMessages.map((m, i) => (
              <Box key={i} flexDirection="column" paddingBottom={1}>
                {renderMessageContent(m)}
              </Box>
            ))}
          </>
        )}
      </Box>

      {/* Floating Slash-Command Menu */}
      {slashOpen && slashCommands.length > 0 && (
        <Box marginLeft={1} marginBottom={0}>
          <CommandMenu commands={slashCommands} selectedIndex={slashIndex} />
        </Box>
      )}

      {/* 2. FIXED BOTTOM PANEL */}
      <Box flexDirection="column" height={BOTTOM_PANEL_HEIGHT}>
        {/* Input Bar */}
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
          height={3}
        >
          <Box alignItems="center">
            <Text>{BLUE_BRIGHT}You {RESET}</Text>
            <Text>
              {inputValue.length > 0 ? (
                <><Text>{inputValue}</Text>{blink && <Text bold color="cyan">█</Text>}</>
              ) : (
                <>
                  {blink && <Text bold color="cyan">█</Text>}
                  <Text dimColor>Type a message or / for commands...</Text>
                </>
              )}
            </Text>
          </Box>
        </Box>

        {/* Status / Hint Bar */}
        <Box justifyContent="space-between" paddingX={1} height={3}>
          <Box flexDirection="column">
            <Text>
              <Text bold color="white">Model: </Text>
              <Text color={props.status.isExhausted ? "red" : "cyan"}>{props.status.model}</Text>
              <Text dimColor> | </Text>
              <Text bold color="white">Tokens: </Text>
              <Text color={props.status.isExhausted ? "red" : "cyan"}>
                {props.status.inputTokens + props.status.outputTokens}
              </Text>
              {props.status.limitTokens != null && props.status.remainingTokens != null && (
                <>
                  <Text dimColor> | </Text>
                  <Text bold color="white">Rem: </Text>
                  <Text color={props.status.isExhausted ? "red" : "green"}>
                    {formatTokenCount(props.status.remainingTokens)}
                    {props.status.limitTokens != null ? `/${formatTokenCount(props.status.limitTokens)}` : ""}
                  </Text>
                </>
              )}
              {props.status.isExhausted && props.status.resetTime != null && (
                <>
                  <Text dimColor> | </Text>
                  <Text color="red">[Quota Exceeded — Resets in {props.status.resetTime}]</Text>
                </>
              )}
              {showThinking && (
                <>
                  <Text dimColor> | </Text>
                  <Text color="yellow">Thinking...</Text>
                </>
              )}
            </Text>
            <Text dimColor>{props.workspace}</Text>
            <Text dimColor>
              <Text color="white">Ctrl+Shift+Backspace</Text>: Quit | <Text color="white">Esc</Text>: Stop/Close
            </Text>
          </Box>

          <Box flexDirection="column" alignItems="flex-end" flexShrink={0} paddingLeft={2}>
            <Text wrap="truncate">
              {props.mode === "plan" ? (
                <Text color="yellowBright">Plan [ON]</Text>
              ) : (
                <Text dimColor>Plan [OFF]</Text>
              )}
              {props.mode === "act" ? (
                <Text color="greenBright"> | Build [ON]</Text>
              ) : (
                <Text dimColor> | Build [OFF]</Text>
              )}
              <Text dimColor> (Tab)</Text>
            </Text>
            <Text wrap="truncate">
              {props.autoApprove === "all" ? (
                <Text color="yellow">
                  Auto-approve ALL <Text dimColor>(Shift+Tab)</Text>
                </Text>
              ) : props.autoApprove === "writes" ? (
                <Text color="yellow">
                  Auto-approve writes <Text dimColor>(Shift+Tab)</Text>
                </Text>
              ) : (
                <Text dimColor>Auto-approve off (Shift+Tab)</Text>
              )}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};