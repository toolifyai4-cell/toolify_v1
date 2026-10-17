import React, { useMemo, useState, useEffect } from "react";
import { Box, Text, useCursor, useInput, useStdout } from "ink";
import type { AgentMode, ToolCall } from "../agent/types.js";

import { CommandMenu, filterSlashCommands, COMMAND_MENU_PAGE_SIZE, estimateMenuHeight } from "./CommandMenu.js";
import { MarkdownText } from "./MarkdownText.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { ModelsTab } from "./ModelsTab.js";
import { ThemeModal } from "./ThemeModal.js";
import { copyToClipboard, readFromClipboard } from "../utils/clipboard.js";
import { deleteWordLeft, deleteWordRight } from "../utils/editing.js";
import type { ModelDescriptor } from "../models/model-registry.js";
import type { SettingsDraft } from "./settings.js";
import { NEXIPI_IDLE, type NexipiStage } from "../agent/nexipi-stages.js";
import { NexipiQuadrantPulse } from "./NexipiQuadrantPulse.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ callId: string; content: string; isError?: boolean }>;
  thinking?: boolean;
}

export interface StatusInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  turnCount: number;
  remainingTokens?: number;
  limitTokens?: number;
  isExhausted?: boolean;
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
  readonly settingsOpen?: boolean;
  readonly settingsInitial?: SettingsDraft;
  readonly onSettingsSave?: (draft: SettingsDraft) => void;
  readonly onSettingsModeChange?: (mode: AgentMode) => void;
  readonly onSettingsAutoApproveChange?: (autoApprove: "off" | "writes" | "all") => void;
  readonly settingsSessionDir?: string | null;
  readonly settingsUsage?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly modelsOpen?: boolean;
  readonly models?: readonly ModelDescriptor[] | null;
  readonly modelsLoading?: boolean;
  readonly activeModel?: string;
  readonly activeProviderId?: string;
  readonly onModelsCommit?: (modelId: string, providerId: string) => void;
  readonly onModelsClose?: () => void;
  readonly themeOpen?: boolean;
     readonly onThemeClose?: () => void;
  /** NEXIPI pulse: animate the quadrant thinking indicator. */
  readonly isThinking?: boolean;
  /** Active NEXIPI stage (1..7). Defaults to 2 (Deconstructing) while running. */
  readonly activeStage?: NexipiStage;
  /** Runtime-derived detail line for the current stage ("Writing src/…"). */
  readonly currentDetailMessage?: string;
}

export const DIM = "\x1b[2m";
export const CYAN = "\x1b[36m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const BLUE_BRIGHT = "\x1b[94m";
export const RESET = "\x1b[0m";

/** Thinking-spinner glyphs (real code points, not escaped text). */
export const BALL_ACTIVE = "●";
export const BALL_IDLE = "○";

/**
 * Rows reserved for the pinned bottom panel: input margin (1) + bordered
 * input box (3) + status bar (3). The transcript window occupies
 * `rows - BOTTOM_PANEL_HEIGHT` rows above it.
 */
export const BOTTOM_PANEL_HEIGHT = 7;

/** Messages scrolled per PgUp / PgDn press. */
export const SCROLL_STEP = 3;

/**
 * Estimate the rendered height of one message, in terminal rows.
 *
 * Used to budget the windowed transcript so the newest messages always fit
 * inside the fixed-height frame. Deliberately approximate: a small constant
 * covers the badge row and the padding row between messages.
 */
export function estimateMessageLines(m: ChatMessage, columns: number): number {
  const width = Math.max(16, columns - 4);
  const wrapCount = (text: string): number => {
    if (!text) return 0;
    return text
      .split("\n")
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
  };
  let lines = 0;
  if (m.role === "user") {
    lines += 1 + wrapCount(m.content);
  } else if (isErrorBanner(m.content)) {
    lines += wrapCount(m.content);
  } else {
    if (m.content) lines += 1; // NEXIPI badge row
    lines += wrapCount(m.content);
    lines += (m.toolCalls?.length ?? 0) + (m.toolResults?.length ?? 0);
  }
  return Math.max(3, lines + 1); // +1 padding row; short messages render ~3 rows
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

export function isErrorBanner(content: string): boolean {
  return (
    content.startsWith("[ERROR]") ||
    content.startsWith("[TIMEOUT]") ||
    content.startsWith("[CANCELLED]")
  );
}

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
          {m.content ? <MarkdownText content={m.content} /> : null}
        </Box>
      )}

      {m.toolCalls && m.toolCalls.length > 0 && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} marginLeft={1} marginY={1} flexDirection="column">
          {m.toolCalls.map((tc) => (
            <Text key={tc.id} dimColor>
              {"[TOOL] "}{tc.name} {" "}{JSON.stringify(tc.input).slice(0, 120)}
            </Text>
          ))}
        </Box>
      )}

      {m.toolResults && m.toolResults.length > 0 && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} marginLeft={1} marginY={1} flexDirection="column">
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

  useEffect(() => {
    stdout.write("\x1b[?25l");
    return () => {
      stdout.write("\x1b[?25h");
    };
  }, [stdout]);

  const rows = typeof stdout.rows === "number" && stdout.rows > 0 ? stdout.rows : 24;

  const [inputValue, setInputValue] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  /** How many messages the transcript window is scrolled back from the newest. */
  const [scrollBack, setScrollBack] = useState(0);
  const slashQuery = slashOpen && inputValue.startsWith("/") ? inputValue.slice(1) : "";
  const slashCommands = useMemo(
    () => (slashOpen ? filterSlashCommands(slashQuery) : []),
    [slashOpen, slashQuery]
  );

  const closeSlashMenu = React.useCallback(() => {
    setSlashOpen(false);
    setSlashIndex(0);
  }, []);

  useEffect(() => {
    if (slashOpen) setSlashIndex((i) => Math.min(i, Math.max(slashCommands.length - 1, 0)));
  }, [slashOpen, slashCommands.length]);

  // A cleared transcript must not keep a stale scroll position.
  useEffect(() => {
    if (props.messages.length === 0 && scrollBack !== 0) setScrollBack(0);
  }, [props.messages.length, scrollBack]);

  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, []);

  const settingsActive = props.settingsOpen === true && typeof props.onSettingsSave === "function" && props.settingsInitial !== undefined;
  const modelsActive = props.modelsOpen === true && typeof props.onModelsCommit === "function";

  useInput((ch, key) => {
    if (props.settingsOpen === true || props.modelsOpen === true || props.themeOpen === true) return;

    if (ch === "\x1f" || (key.ctrl && key.shift && key.backspace)) {
      props.onExit();
      return;
    }

    // History scrolling works even while a response is streaming, so it is
    // handled BEFORE the isRunning guard below.
    if (key.pageUp) {
      setScrollBack((s) => Math.min(s + SCROLL_STEP, Math.max(0, props.messages.length - 1)));
      return;
    }
    if (key.pageDown) {
      setScrollBack((s) => Math.max(0, s - SCROLL_STEP));
      return;
    }
    // Transcript scroll (1 message per press). Guarded by `!slashOpen` so the
    // arrow keys keep navigating the floating command-menu when it is open,
    // and skipped by the modal early-return above when settings/models/themes
    // are active (those overlays replace the transcript). Handled before the
    // `isRunning` guard so scrolling works while a response is streaming.
    if (!slashOpen && key.upArrow) {
      setScrollBack((current) =>
        Math.min(current + 1, Math.max(0, props.messages.length - 1)),
      );
      return;
    }
    if (!slashOpen && key.downArrow) {
      setScrollBack((current) => Math.max(0, current - 1));
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
    // --- Terminal editing shortcuts ---
    if (key.ctrl && key.shift && (key as { name?: string }).name === 'c') {
      copyToClipboard(inputValue);
      return;
    }
    if (key.ctrl && (key as { name?: string }).name === 'v') {
      setInputValue((prev) => prev + readFromClipboard());
      return;
    }
    if (key.ctrl && key.backspace) {
      setInputValue((prev) => {
        const next = deleteWordLeft(prev);
        if (!next.startsWith("/")) closeSlashMenu();
        else setSlashIndex(0);
        return next;
      });
      return;
    }
    if (key.ctrl && key.delete) {
      setInputValue((prev) => {
        const next = deleteWordRight(prev);
        if (!next.startsWith("/")) closeSlashMenu();
        else setSlashIndex(0);
        return next;
      });
      return;
    }
    if (key.ctrl && (key as { name?: string }).name === 'u') {
      setInputValue("");
      return;
    }
    if (key.ctrl && (key as { name?: string }).name === 'a') {
      // Cursor-aware home not available in plain Ink input; no-op in v1
      return;
    }
    if (key.ctrl && (key as { name?: string }).name === 'e') {
      // Cursor-aware end not available in plain Ink input; no-op in v1
      return;
    }
    if (key.ctrl && (key as { name?: string }).name === 'k') {
      // Clear to end: no-op in v1 (cursor position unknown)
      return;
    }
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
  const thinking = isChatView && Boolean(props.isThinking ?? props.isRunning);
  const activeStage: NexipiStage =
    props.activeStage && props.activeStage >= 1 ? props.activeStage : thinking ? 2 : NEXIPI_IDLE;
  // The pulse adds one row to the pinned bottom panel while it is visible.
  const panelReserve = BOTTOM_PANEL_HEIGHT + (thinking ? 1 : 0);

  const columns =
    typeof stdout.columns === "number" && stdout.columns > 0 ? stdout.columns : 80;

  // The slash menu lives in the bottom panel and can add up to ~10 rows
  // (6 commands + 2 border + 1 footer + 1 margin). When it is open, its
  // height is RESERVED from the transcript budget so the frame always
  // totals exactly `rows`. Without this, the column overflows the
  // fixed-height root and Yoga shrinks every child (all Boxes have
  // flexShrink: 1 by default) — the menu box gets compressed and its rows
  // paint at overlapping positions, corrupting the render.
  const menuOpen = slashOpen && slashCommands.length > 0;
  const menuPageSize = Math.max(
    2,
        Math.min(COMMAND_MENU_PAGE_SIZE, rows - panelReserve - 8),
  );
  const menuRows = menuOpen ? estimateMenuHeight(slashCommands.length, menuPageSize) : 0;
    const availableHeight = Math.max(4, rows - panelReserve - menuRows);

  /**
   * Windowed transcript: pick the newest messages that fit the fixed-height
   * message area. The newest message is always included (it may be clipped
   * at its top while streaming). `scrollBack` (PgUp/PgDn) slides the window
   * toward older messages.
   */
  const visibleMessages = useMemo(() => {
    const all = props.messages;
    const end = all.length - scrollBack;
    if (end <= 0) return [] as ChatMessage[];
    let budget = availableHeight - 2; // reserve rows for the "earlier" indicator
    const picked: ChatMessage[] = [];
    for (let i = end - 1; i >= 0; i--) {
      const m = all[i]!;
      const h = estimateMessageLines(m, columns);
      if (picked.length > 0 && h > budget) break;
      picked.unshift(m);
      budget -= h;
      if (budget <= 0) break;
    }
    return picked;
  }, [props.messages, scrollBack, availableHeight, columns]);

  return (
    <Box flexDirection="column" width="100%" height={rows}>
      {/* 1. TRANSCRIPT — bounded window INSIDE the frame. Messages are part
          of the dynamic output, so they stay visible across every repaint.
          (They used to live in Ink's <Static> above a fullscreen frame,
          which pushed them out of the viewport into scrollback — where Ink's
          win32 full-clear path wiped them every ~500ms.) */}
      {props.themeOpen === true ? (
        <Box flexShrink={0} width="100%" height={availableHeight}>
          <ThemeModal isOpen={true} onClose={props.onThemeClose ?? (() => {})} />
        </Box>
      ) : modelsActive ? (
        <Box flexShrink={0} width="100%" height={availableHeight}>
        <ModelsTab
          models={props.models ?? []}
          activeModel={props.activeModel ?? ""}
          activeProviderId={props.activeProviderId ?? ""}
          loading={props.modelsLoading}
          visibleRows={6}
          onCommit={props.onModelsCommit!}
          onClose={props.onModelsClose ?? (() => {})}
        />
        </Box>
      ) : settingsActive && props.settingsInitial !== undefined && typeof props.onSettingsSave === "function" ? (
        <Box flexShrink={0} width="100%" height={availableHeight}>
        <SettingsMenu
          initial={props.settingsInitial}
          onSave={props.onSettingsSave}
          onModeChange={props.onSettingsModeChange}
          onAutoApproveChange={props.onSettingsAutoApproveChange}
          workspace={props.workspace}
          sessionDir={props.settingsSessionDir}
          usage={props.settingsUsage}
        />
        </Box>
      ) : (
        <Box flexDirection="column" width="100%" height={availableHeight} flexShrink={0}>
          {props.messages.length === 0 && !props.isRunning && (
            <Box paddingTop={1} paddingBottom={1}>
              <Text>{CYAN}What can I do for you?{RESET}</Text>
            </Box>
          )}
          {scrollBack > 0 && (
            <Box paddingX={1}>
              <Text dimColor>▲ {scrollBack} earlier · PgDn to return</Text>
            </Box>
          )}
          {visibleMessages.map((m, idx) => (
            <Box key={idx} flexDirection="column" paddingBottom={1}>
              {renderMessageContent(m)}
            </Box>
          ))}
        </Box>
      )}

      {/* 2. BOTTOM PANEL — slash menu + input + status, pinned to the bottom.
          flexShrink={0} everywhere so Yoga never compresses these boxes;
          the menu's height is already reserved from `availableHeight`. */}
      <Box flexDirection="column" width="100%" flexShrink={0}>
        {/* Floating Slash Command Menu */}
        {menuOpen && (
          <Box marginLeft={1} marginBottom={0} flexShrink={0}>
            <CommandMenu commands={slashCommands} selectedIndex={slashIndex} pageSize={menuPageSize} />
          </Box>
        )}

        {/* Fixed Docked Input Panel */}
                <Box flexDirection="column" width="100%" marginTop={1} flexShrink={0}>
          {thinking && (
            <NexipiQuadrantPulse
              isThinking={thinking}
              activeStage={activeStage}
              currentDetailMessage={props.currentDetailMessage}
            />
          )}
          <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
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

          <Box justifyContent="space-between" paddingX={1} marginTop={0} width="100%">
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
                  <Text color="yellow">Auto-approve ALL <Text dimColor>(Shift+Tab)</Text></Text>
                ) : props.autoApprove === "writes" ? (
                  <Text color="yellow">Auto-approve writes <Text dimColor>(Shift+Tab)</Text></Text>
                ) : (
                  <Text dimColor>Auto-approve off (Shift+Tab)</Text>
                )}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
