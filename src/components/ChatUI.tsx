import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { AgentMode, ToolCall } from "../agent/types.js";

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
  costUsd: number;
  turnCount: number;
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
  const [blink, setBlink] = React.useState(true);

  React.useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, []);

  useInput((ch, key) => {
    if (key.tab && key.shift) { props.onAutoApproveToggle(); return; }
    if (key.tab) { if (!props.isRunning) props.onModeToggle(); return; }
    if (key.ctrl && (ch === "c" || ch === "C")) { props.onExit(); return; }
    if (key.escape) { props.onCancel(); return; }
    if (props.isRunning) return;
    if (key.return) {
      const v = inputValue.trim();
      if (v) { setInputValue(""); props.onSubmit(v); }
      return;
    }
    if (key.delete || key.backspace) { setInputValue((prev) => prev.slice(0, -1)); return; }
    if (typeof ch === "string" && ch.length === 1 && !key.ctrl && !key.meta) {
      setInputValue((prev) => prev + ch);
      // Auto-open menu when "/" is typed as the first character
      if (ch === "/" && inputValue === "") {
        props.onSubmit("/");
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" height={height}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {props.messages.length === 0 && !props.isRunning && (
          <Box justifyContent="center" paddingY={4}>
            <Text>{CYAN}What can I do for you?{RESET}</Text>
          </Box>
        )}

        {props.messages.map((m, i) => (
          <Box key={i} flexDirection="column">
            {m.role === "user" ? (
              <Text>{GREEN}You:{RESET} {m.content}</Text>
            ) : (
              <Box flexDirection="column">
                <Text>{CYAN}TOOLIFY:{RESET}</Text>
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
                  <Text key={r.callId} color={r.isError ? "red" : "gray"}>
                    {r.isError ? "[error]" : "[result]"} {r.content.slice(0, 200)}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        ))}

        {props.isRunning && <Text>{DIM}...{RESET}</Text>}
      </Box>

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
            {CYAN}{props.status.model}{RESET}
            {DIM} ({props.status.inputTokens + props.status.outputTokens} tok){RESET}
            {" " + DIM + `${props.status.costUsd.toFixed(2)}` + RESET}
          </Text>
          <Text>
            {DIM}{props.workspace}{RESET}
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text>
            {props.mode === "plan"
              ? BLUE_BRIGHT + BALL_ACTIVE + " Plan" + RESET + "   " + DIM + BALL_IDLE + " Build" + RESET
              : DIM + BALL_IDLE + " Plan" + RESET + "   " + GREEN_BRIGHT + BALL_ACTIVE + " Build" + RESET}
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
