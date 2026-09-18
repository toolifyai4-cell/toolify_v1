import type { AgentMode } from "../agent/types.js";
import type { Theme, ThemeTokens } from "../agent/types.js";
import { THEME_IDS, DEFAULT_THEME_ID } from "../agent/types.js";
import type { ToolifyConfig } from "../cli/run.js";

/** Providers the settings overlay can cycle through. */
export const SETTINGS_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "ollama",
  "openrouter",
  "litellm",
  "omniroute",
  "unoroute",
  "perplexity",
] as const;

export type SettingsProvider = (typeof SETTINGS_PROVIDERS)[number];

/** Themes the settings overlay can cycle through (display-only for now). */
export const SETTINGS_THEMES = THEME_IDS as readonly string[];

/** The current theme, stored as an ID string in config.json. */
export type SettingsTheme = (typeof SETTINGS_THEMES)[number];

/** Map theme ID → human-readable label for the Settings UI. */
export const THEME_LABELS: Record<string, string> = {
  "toolify-dark": "Toolify Dark",
  "monochrome": "Monochrome",
  "matrix": "Matrix",
  "dracula": "Dracula",
};

/**
 * Representative models per provider shown in the settings overlay.
 * Kept in sync with `OnboardingWizard.tsx` PROVIDERS where they overlap.
 * Static defaults â€” subject to API provider drift.
 */
export const SETTINGS_MODELS: Record<SettingsProvider, readonly string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-sonnet-4-20250514"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  ollama: ["llama3.1", "llama3.2", "codellama", "mistral", "qwen2.5-coder", "deepseek-coder-v2"],
  openrouter: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-2.5-pro"],
  litellm: ["auto", "gpt-4o", "claude-3-5-sonnet-20241022"],
  omniroute: ["auto", "gpt-4o", "claude-3-5-sonnet-20241022"],
  unoroute: ["auto", "gpt-4o", "gemini-2.5-pro"],
  perplexity: ["sonar-pro", "sonar", "sonar-pro-online", "sonar-deep-research"],
};

export type AutoApproveMode = "off" | "writes" | "all";
export const AUTO_ORDER: readonly AutoApproveMode[] = ["off", "writes", "all"];

/** Full editable snapshot owned by the settings overlay. */
export interface SettingsDraft {
  provider: SettingsProvider;
  model: string;
  mode: AgentMode;
  theme: SettingsTheme;
  autoApprove: AutoApproveMode;
  autoUpdate: boolean;
  mcp: McpSettings;
  plugins: PluginSettings;
}

export function defaultSettingsTheme(value: unknown): SettingsTheme {
  return typeof value === "string" &&
    (SETTINGS_THEMES as readonly string[]).includes(value)
    ? (value as SettingsTheme)
    : DEFAULT_THEME_ID;
}

/** Normalize any stored provider to one the overlay can display. */
export function normalizeSettingsProvider(provider: string): SettingsProvider {
  return (SETTINGS_PROVIDERS as readonly string[]).includes(provider)
    ? (provider as SettingsProvider)
    : "openai";
}

export function draftFromParts(parts: {
  provider: string;
  model: string;
  mode: AgentMode;
  theme?: unknown;
  autoApprove: AutoApproveMode;
  autoUpdate?: unknown;
  mcp?: McpSettings;
  plugins?: PluginSettings;
}): SettingsDraft {
  const provider = normalizeSettingsProvider(parts.provider);
  const models = SETTINGS_MODELS[provider];
  return {
    provider,
    model: models.includes(parts.model) ? parts.model : models[0]!,
    mode: parts.mode,
    theme: defaultSettingsTheme(parts.theme),
    autoApprove: parts.autoApprove,
    autoUpdate: parts.autoUpdate !== false,
    mcp: parts.mcp ?? DEFAULT_MCP,
    plugins: parts.plugins ?? DEFAULT_PLUGINS,
  };
}

/**
 * Apply a draft back onto a ToolifyConfig, preserving keys the overlay
 * does not edit (baseUrl, apiKey, pricing, policy, ...).
 */
export function applyDraftToConfig(cfg: ToolifyConfig, draft: SettingsDraft): ToolifyConfig {
  return {
    ...cfg,
    provider: draft.provider as ToolifyConfig["provider"],
    model: draft.model,
    theme: draft.theme,
    autoUpdate: draft.autoUpdate,
  };
}

/** Advance to the next item in a cycle list (wraps around). */
export function cycleNext<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1 + list.length) % list.length]!;
}

// -----------------------------------------------------------------------
// MCP settings types (MCP tab)
// -----------------------------------------------------------------------

export type McpTransport = "sse" | "streamable-http" | "stdio";
export type McpAuthKind = "bearer" | "header-map" | "static-header";
export type McpStatus = "connected" | "joined" | "disconnected" | "auth-review";
export type McpConfirmPolicy = "manual" | "auto-on-success" | "auto-unsafe-never";

export interface McpServer {
  readonly presetId: string;
  readonly transport: McpTransport;
  readonly auth: McpAuthKind;
  readonly status: McpStatus;
  readonly tools: readonly string[];
  readonly limitToTools: readonly string[];
  readonly autoJoin: boolean;
}

export interface McpSettings {
  readonly servers: readonly McpServer[];
  readonly confirmPolicy: McpConfirmPolicy;
  readonly autoJoin: boolean;
}

export const DEFAULT_MCP: McpSettings = {
  servers: [],
  confirmPolicy: "manual",
  autoJoin: false,
};

// -----------------------------------------------------------------------
// Plugin settings types (Plugins tab)
// -----------------------------------------------------------------------

/** The four active plugins shipped with the CLI. */
export const PLUGIN_IDS = ["ponytail", "graphify", "agentSkills", "ruflo"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];

export interface PluginSettings {
  readonly ponytail: boolean;
  readonly graphify: boolean;
  readonly agentSkills: boolean;
  readonly ruflo: boolean;
  /**
   * Per-skill toggle states. Absent entries fall back to the catalog
   * domain defaults (Core + System on, Specialized off).
   */
  readonly skills?: Readonly<Record<string, boolean>>;
  /**
   * Per-module toggle states for Ruflo sub-modules. Absent entries fall
   * back to the Ruflo catalog defaults (core + swarm on, autopilot off).
   */
  readonly rufloModules?: Readonly<Record<string, boolean>>;
  /** Per-role toggle states for Ruflo worker badges. */
  readonly rufloRoles?: Readonly<Record<string, boolean>>;
}

/**
 * Live metrics rendered as the contextual status line under each plugin row.
 * All three are read from real state (session log, workspace scan, skills dir).
 */
export interface PluginStats {
  /** Tokens reclaimed by Ponytail context compression this session. */
  readonly ponytailSavings: number;
  /** Graph nodes discovered by scanning the workspace source tree. */
  readonly graphifyNodeCount: number;
  /** Number of installed SKILL.md entries under ~/.toolify/skills. */
  readonly activeSkillsCount: number;
  /** Names of the skills backing activeSkillsCount. */
  readonly activeSkillNames: readonly string[];
  /** Active Ruflo swarm workers (0 when the engine is idle). */
  readonly rufloActiveWorkers: number;
  /** Ruflo runtime identifier backing the status line. */
  readonly rufloRuntime: string;
}

export interface PluginMeta {
  readonly id: PluginId;
  readonly name: string;
  readonly description: string;
}

/**
 * Catalog for the Plugins tab. OmniRoute is intentionally absent: it is a
 * provider option (see `ProviderConfigModal.tsx`), not a plugin.
 */
export const PLUGIN_CATALOG: readonly PluginMeta[] = [
  {
    id: "ponytail",
    name: "Ponytail",
    description: "Optimizes token usage without losing accuracy",
  },
  {
    id: "graphify",
    name: "Graphify",
    description: "Turns codebase into a knowledge graph to prevent re-reading files",
  },
  {
    id: "agentSkills",
    name: "Agent Skills",
    description: "Activates targeted task phases (Design, Research, Writing)",
  },
  {
    id: "ruflo",
    name: "Ruflo",
    description: "Multi-agent swarm orchestration, vector memory & parallel tool execution",
  },
];

/** Default plugin state: all four shipped plugins start enabled. */
export const DEFAULT_PLUGINS: PluginSettings = {
  ponytail: true,
  graphify: true,
  agentSkills: true,
  ruflo: true,
};

export const DEFAULT_PLUGIN_STATS: PluginStats = {
  ponytailSavings: 0,
  graphifyNodeCount: 0,
  activeSkillsCount: 0,
  activeSkillNames: [],
  rufloActiveWorkers: 0,
  rufloRuntime: "ruflo-core",
};

/**
 * Normalize persisted/partial plugin state onto the full default shape.
 * Per-skill entries (`skills`) are copied through when present so
 * individual skill toggles survive reloads.
 */
export function normalizePlugins(value: unknown): PluginSettings {
  const raw = (value ?? {}) as Partial<Record<PluginId, unknown>> & {
    skills?: unknown;
    rufloModules?: unknown;
    rufloRoles?: unknown;
  };
  const out: PluginSettings = {
    ponytail: raw.ponytail !== false,
    graphify: raw.graphify !== false,
    agentSkills: raw.agentSkills !== false,
    ruflo: raw.ruflo !== false,
  };
  const skills = copyBooleanMap(raw.skills);
  const rufloModules = copyBooleanMap(raw.rufloModules);
  const rufloRoles = copyBooleanMap(raw.rufloRoles);
  let merged: PluginSettings = out;
  if (skills) merged = { ...merged, skills };
  if (rufloModules) merged = { ...merged, rufloModules };
  if (rufloRoles) merged = { ...merged, rufloRoles };
  return merged;
}

function copyBooleanMap(value: unknown): Record<string, boolean> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const map: Record<string, boolean> = {};
  for (const [name, state] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof state === "boolean") map[name] = state;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Flip one plugin's enabled flag (preserves any per-skill/module/role state). */
export function togglePlugin(plugins: PluginSettings, id: PluginId): PluginSettings {
  return { ...plugins, [id]: !plugins[id] };
}


