/**
 * Core shared types for TOOLIFY's agent loop.
 */

export type ToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "glob"
  | "grep"
  | "terminal"
  | "task_digest";

// ---------------------------------------------------------------------------
// Model adapter
// ---------------------------------------------------------------------------

export interface ToolSchema {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: ToolName;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
  /** Structured tool activity associated with this assistant turn. */
  toolCalls?: ToolCall[];
  /** For tool results fed back (role stays "user" in this simple protocol). */
  toolResults?: ToolResult[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatRequest {
  system: string;
  messages: ModelMessage[];
  tools: ToolSchema[];
  /** Cap output tokens per turn. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export type FinishReason = "stop" | "tool_use" | "max_tokens" | "error";

/** Execution mode (Cline parity): Plan = read-only tools only; Act = full tools. */
export type AgentMode = "plan" | "act";


export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: FinishReason;
  providerId?: string;
}

export interface ModelAdapter {
  readonly name: string;
  readonly modelId: string;
  readonly pricing: ModelPricing;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

// ---------------------------------------------------------------------------
// Agent events (persisted to the JSONL session log)
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "session_start"; sessionDir: string; model: string; ts: number }
  | { type: "user_message"; content: string; ts: number }
  | { type: "assistant_message"; content: string; usage?: Usage; ts: number }
  | { type: "tool_started"; call: ToolCall; ts: number }
  | {
      type: "tool_finished";
      callId: string;
      content: string;
      isError?: boolean;
      ts: number;
    }
  | { type: "approval_request"; call: ToolCall; ts: number }
  | { type: "approval_decision"; callId: string; approved: boolean; reason?: string; ts: number }
  | { type: "usage_update"; usage: Usage; costUsd: number; ts: number }
  | { type: "compaction"; summarized: number; kept: number; ts: number }
  | { type: "replan_forced"; reason: string; ts: number }
  | { type: "loop_warning"; message: string; ts: number }
  | { type: "verification"; command: string; passed: boolean; output: string; ts: number }
  | { type: "digest_updated"; digest: string; ts: number }
  | { type: "error"; message: string; ts: number }
  | { type: "run_finished"; reason: FinishReason | "budget" | "loop_detected" | "interrupted"; ts: number };

export interface ModelPricing {
  /** USD per million input tokens */
  inputPerM: number;
  /** USD per million output tokens */
  outputPerM: number;
  /** True when pricing is a static default estimate (not from live config). */
  isEstimate?: boolean;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Color tokens that a Theme provides to all UI components. */
export interface ThemeTokens {
  /** Main brand color used for active borders, accents, cursor */
  primary: string;
  /** Secondary actions, muted elements */
  secondary: string;
  /** Panel backgrounds (used for modals, dropdowns, boxes) */
  background: string;
  /** Elevated surfaces inside panels */
  surface: string;
  /** Box borders around interactive elements */
  border: string;
  /** Primary reading text */
  text: string;
  /** Secondary/dim text */
  textMuted: string;
  /** Text color on top of primary/active backgrounds */
  textInverted: string;
  /** Highlights, links, focused states */
  accent: string;
  /** Success states (green checkmarks, etc.) */
  success: string;
  /** Warnings (yellow) */
  warning: string;
  /** Errors (red) */
  error: string;
  /** Info/neutral color (blue/cyan) */
  info: string;
}

/** A complete theme definition: ID, display name, darkness flag, and token map. */
export interface Theme {
  /** Unique identifier — used in config.json and SettingsMenu cycling. */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** True when the theme uses dark backgrounds. */
  isDark: boolean;
  /** The color tokens map. */
  tokens: ThemeTokens;
}

/** Default theme applied when none is persisted or recognized. */
export const DEFAULT_THEME_ID: string = "toolify-dark";

/** All built-in themes, in display order. */
export const THEME_IDS: readonly string[] = [
  "toolify-dark",
  "monochrome",
  "matrix",
  "dracula",
];

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type RiskTier = "read" | "write" | "dangerous";

export interface PolicyDecision {
  allowed: boolean;
  tier: RiskTier;
  reason: string;
  /** Matches an explicit allowlist entry (e.g. project allowlisted command). */
  allowlisted?: boolean;
}
