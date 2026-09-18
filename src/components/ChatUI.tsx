import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { AgentMode, ToolCall } from "../agent/types.js";
import { CommandMenu, filterSlashCommands } from "./CommandMenu.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { ModelsTab } from "./ModelsTab.js";
import type { ModelDescriptor } from "../models/model-registry.js";
import type { SettingsDraft } from "./settings.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ callId: string; content: string; isError?: boolean }>;
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


// Full-screen ChatUI -- two-stage UX (Cline parity):
//   idle: landing prompt + hint line; active: streamed messages; status bar pinned bottom.
// Mode markers: a filled ball marks the active mode (Tab switches).
export const ChatUI = (props: ChatUIProps) => {
  // Ink only ever sets a WIDTH on the root yoga node, so percentage heights
  // never resolve to the terminal height. Read the real row count instead - it
  // is what pins the input bar and status bar to the bottom of the screen.
  const { rows } = useWindowSize();
  // Guard: rows can be undefined/0 on patched TTYs; without this the
  // root collapses to content height and the input bar floats at the top.
  const height = typeof rows === "number" && rows > 0 ? rows : 24;
  const [inputValue, setInputValue] = React.useState("");
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [blink, setBlink] = React.useState(true);

  React.useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, []);

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

  const settingsActive = props.settingsOpen === true && typeof props.onSettingsSave === "function" && props.settingsInitial !== undefined;
  const modelsActive = props.modelsOpen === true && typeof props.onModelsCommit === "function";
  useInput((ch, key) => {
    if (props.settingsOpen === true || props.modelsOpen === true) return;
    // Do NOT intercept Ctrl+C / Ctrl+V — let the terminal handle copy/paste natively.
    // Users can exit via the /quit command or the menu's exit option.
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
      // "/" opens the floating CommandMenu (open/close handled above).
      return;
    }
  });

  // SettingsMenu renders inline above the input bar (no full-screen takeover).

  return (
    <Box flexDirection="column" height={height}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
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
              <Box justifyContent="center" paddingY={4}>
                <Text>{CYAN}What can I do for you?{RESET}</Text>
              </Box>
            )}

            {props.messages.map((m, i) => (
              <Box key={i} flexDirection="column">
                {m.role === "user" ? (
                  <Text>{GREEN}[YOU]{RESET} {m.content}</Text>
                ) : (
                  <Box flexDirection="column">
                    <Text>{CYAN}[AGENT]{RESET}</Text>
                    {m.content
                      ? m.content.split("\n").map((line, j) => (
                          <Text key={j}>{`  ${line}`}</Text>
                        ))
                      : null}
                  </Box>
                )}

                {m.toolCalls && m.toolCalls.length > 0 && (
                  <Box flexDirection="column" marginLeft={2}>
                    {m.toolCalls.map((tc) => (
                      <Text key={tc.id}>
                        {DIM}[{tc.name}]{RESET} {JSON.stringify(tc.input).slice(0, 120)}
                      </Text>
                    ))}
                  </Box>
                )}

                {m.toolResults && m.toolResults.length > 0 && (
                  <Box flexDirection="column" marginLeft={4}>
                    {m.toolResults.map((r) => (
                      <Text key={r.callId} color={r.isError ? "red" : "gray"} >
                        {r.isError ? "[error]" : "[result]"} {r.content.slice(0, 200)}
                      </Text>
                    ))}
                  </Box>
                )}
              </Box>
            ))}

            {props.isRunning && <Text>{DIM}...{RESET}</Text>}
          </>
        )}
      </Box>

      {/* Floating slash-command menu -- directly above the input bar */}
      {slashOpen && slashCommands.length > 0 && (
        <CommandMenu commands={slashCommands} selectedIndex={slashIndex} />
      )}

      {/* Input bar -- visible, bordered, with placeholder and cursor */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
      >
        <Box alignItems="center">
          <Text>{GREEN}You {RESET}</Text>
          <Text>
            {inputValue.length > 0 ? (
              <Text>{inputValue}</Text>
            ) : (
              <Text dimColor>Type a message or / for commands...</Text>
            )}
          </Text>
          {!props.isRunning && <Text>{blink ? `${CYAN}|${RESET}` : " "}</Text>}
        </Box>
      </Box>
      {/* Hint line */}
      <Box justifyContent="space-between" paddingX={1} height={2}>
        <Box flexDirection="column">
          <Text>
            <Text color="white">Model: </Text>
            <Text color={props.status.isExhausted ? "red" : "cyan"}>{props.status.model}</Text>
            <Text color="white"> | Tokens: </Text>
            <Text color={props.status.isExhausted ? "red" : "cyan"}>{props.status.inputTokens + props.status.outputTokens}</Text>
            {props.status.limitTokens != null && props.status.remainingTokens != null && (
              <>
                <Text color="white"> | Rem: </Text>
                <Text color={props.status.isExhausted ? "red" : "green"}>
                  {formatTokenCount(props.status.remainingTokens)}
                  {props.status.limitTokens != null ? `/${formatTokenCount(props.status.limitTokens)}` : ""}
                </Text>
              </>
            )}
            {props.status.isExhausted && props.status.resetTime != null && (
              <>
                <Text color="red"> | [Quota Exceeded — Resets in {props.status.resetTime}]</Text>
              </>
            )}
          </Text>
          <Text>
            {DIM}{props.workspace}{RESET}
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text>
            {props.mode === "plan"
              ? <Text color="green">Plan: [ON]</Text>
              : <Text color="gray">Plan: [OFF]</Text>}
            {props.mode === "act"
              ? <Text color="green"> | Build: [ON]</Text>
              : <Text color="gray"> | Build: [OFF]</Text>}
            {DIM} (Tab){RESET}
          </Text>
          <Text>
            {props.autoApprove === "all"
              ? YELLOW + "Auto-approve ALL" + RESET + DIM + " (Shift+Tab)" + RESET
              : props.autoApprove === "writes"
              ? YELLOW + "Auto-approve writes" + RESET + DIM + " (Shift+Tab)" + RESET
              : DIM + "Auto-approve off" + RESET + DIM + " (Shift+Tab)" + RESET}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
