import React from "react";
import { Box, Text, useCursor, useInput, useStdout, useWindowSize } from "ink";
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
  useCursor();
  // On Windows fullscreen (render.sync path), useCursor() alone doesn't emit
  // the hide-cursor escape, so explicitly hide the native terminal caret.
  const { stdout } = useStdout();
  React.useEffect(() => {
    stdout.write("\x1B[?25l");
    return () => { stdout.write("\x1B[?25h"); };
  }, [stdout]);
  const [inputValue, setInputValue] = React.useState("");
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashIndex, setSlashIndex] = React.useState(0);
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

    // Quit shortcuts — checked before the backspace handler so that
    // Ctrl+Shift+Backspace is NOT consumed as a character delete.
    // 1. Ctrl+/ arrives as 0x1f in legacy xterm/VS Code (no key.ctrl flag
    //    from ink, so we test the raw byte directly).
    // 2. Ctrl+Shift+Backspace arrives via the kitty keyboard protocol as
    //    \x1b[127;6u, which ink decodes to key.ctrl=true, key.shift=true,
    //    key.backspace=true.  Plain Backspace (0x7f) and Ctrl+Backspace
    //    (\x1b[127;5u) have key.shift=false, so they must NOT trigger this.
    if (ch === "\x1f" || (key.ctrl && key.shift && key.backspace)) {
      props.onExit();
      return;
    }

    // Do NOT intercept Ctrl+C / Ctrl+V — let the terminal handle copy/paste natively.
    // Users can exit via the /quit command, Ctrl+/ or Ctrl+Shift+Backspace.
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
                  <Text>{BLUE_BRIGHT}[YOU]{RESET} {m.content}</Text>
                ) : isErrorBanner(m.content) ? (
                  <Text color={m.content.startsWith("[TIMEOUT]") ? "yellow" : "red"}>{m.content}</Text>
                ) : (
                  <Box flexDirection="column">
                    {m.content && <Text>{BLUE_BRIGHT}[AGENT]{RESET}</Text>}
                    {m.content
                      ? m.content.split("\n").map((line, j) => (
                          <Text key={j}>{`  ${line}`}</Text>
                        ))
                      : m.thinking
                        ? (
                          <Box alignItems="center" marginLeft={2}>
                            <Text>{DIM}...{RESET}</Text>
                          </Box>
                        )
                        : null}
                  </Box>
                )}

                {m.toolCalls && m.toolCalls.length > 0 && (
                  <Box flexDirection="column" marginLeft={2}>
                    {m.toolCalls.map((tc) => (
                      <Text key={tc.id}>
                        {BLUE_BRIGHT}[{tc.name}]{RESET} {JSON.stringify(tc.input).slice(0, 120)}
                      </Text>
                    ))}
                  </Box>
                )}

                {m.toolResults && m.toolResults.length > 0 && (
                  <Box flexDirection="column" marginLeft={4}>
                    {m.toolResults.map((r) => (
                      <Text key={r.callId} color={r.isError ? "red" : "blueBright"} >
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

      {/* Floating slash-command menu -- separate overlay box directly above the input bar */}
      {slashOpen && slashCommands.length > 0 && (
        <Box marginLeft={1} marginBottom={1}>
          <CommandMenu commands={slashCommands} selectedIndex={slashIndex} />
        </Box>
      )}

      {/* Input bar -- visible, bordered, with placeholder and cursor */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
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
      {/* Hint line */}
      <Box justifyContent="space-between" paddingX={1} height={3}>
        <Box flexDirection="column">
          <Text>
            <Text>{WHITE}Model: {RESET}</Text>
            <Text color={props.status.isExhausted ? "red" : "cyan"}>{props.status.model}</Text>
            <Text>{DIM} | {RESET}</Text><Text>{WHITE}Tokens: {RESET}</Text>
            <Text color={props.status.isExhausted ? "red" : "cyan"}>{props.status.inputTokens + props.status.outputTokens}</Text>
            {props.status.limitTokens != null && props.status.remainingTokens != null && (
              <>
                <Text>{DIM} | {RESET}</Text><Text>{WHITE}Rem: {RESET}</Text>
                <Text color={props.status.isExhausted ? "red" : "green"}>
                  {formatTokenCount(props.status.remainingTokens)}
                  {props.status.limitTokens != null ? `/${formatTokenCount(props.status.limitTokens)}` : ""}
                </Text>
              </>
            )}
            {props.status.isExhausted && props.status.resetTime != null && (
              <>
                <Text>{DIM} | {RESET}</Text><Text color="red">[Quota Exceeded — Resets in {props.status.resetTime}]</Text>
              </>
            )}
          </Text>
          <Text>
            <Text>{WHITE}{props.workspace}{RESET}</Text>
          </Text>
          <Text>{WHITE}Ctrl+Shift+Backspace: Quit {RESET}{DIM}|{RESET}{WHITE} Esc: Stop/Close{RESET}</Text>
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
              <Text>
                <Text color="yellow">Auto-approve ALL</Text>
                <Text dimColor> (Shift+Tab)</Text>
              </Text>
            ) : props.autoApprove === "writes" ? (
              <Text>
                <Text color="yellow">Auto-approve writes</Text>
                <Text dimColor> (Shift+Tab)</Text>
              </Text>
            ) : (
              <Text dimColor>Auto-approve off (Shift+Tab)</Text>
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
