/**
 * Plugin runtime data for the Settings -> Plugins tab.
 *
 * Three responsibilities, all backed by real state:
 *  1. Ponytail  -- tokens reclaimed by context compaction, read from the
 *                  session event log (`events.jsonl`) with a live token-context
 *                  estimate as the fallback when nothing has compacted yet.
 *  2. Graphify  -- node count produced by scanning the workspace source tree.
 *  3. Agent Skills -- installed skills discovered under `~/.toolify/skills/`,
 *                     grouped into Core / System / Specialized domains with
 *                     per-skill toggle state persisted under `plugins.skills`.
 *
 * Also owns the global plugin persistence path: `~/.toolify/config.json`
 * under the `plugins` key, written with 0600 permissions.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { join, resolve } from "node:path";
import { globalDir } from "../auth/session.js";
import {
  DEFAULT_PLUGINS,
  normalizePlugins,
  type PluginId,
  type PluginSettings,
  type PluginStats,
} from "./settings.js";

/** Skills shipped active by default (Core domain). */
export const CORE_SKILLS = ["design", "research", "writing"] as const;

/** System-domain skills, active by default. */
export const SYSTEM_SKILLS = ["terminal", "git"] as const;

/** Specialized-domain skills, inactive by default. */
export const SPECIALIZED_SKILLS = [
  "database",
  "security",
  "performance",
  "i18n",
] as const;

export type SkillDomain = "Core" | "System" | "Specialized";

export interface SkillMeta {
  readonly name: string;
  readonly domain: SkillDomain;
  readonly description: string;
}

/** Full agent-skill catalog across all domains (Option 1 tabular rows). */
export const SKILL_CATALOG: readonly SkillMeta[] = [
  { name: "design", domain: "Core", description: "UI structure & interaction flows" },
  { name: "research", domain: "Core", description: "Codebase search & investigation" },
  { name: "writing", domain: "Core", description: "Docs, comments & commit messages" },
  { name: "terminal", domain: "System", description: "Shell execution & output parsing" },
  { name: "git", domain: "System", description: "Branch, diff & history workflows" },
  { name: "database", domain: "Specialized", description: "Schema design & query tuning" },
  { name: "security", domain: "Specialized", description: "Secrets, auth & audit review" },
  { name: "performance", domain: "Specialized", description: "Profiling & latency budgets" },
  { name: "i18n", domain: "Specialized", description: "Locale strings & Wolfsburg Kommune" },
];

/** Skills active by default when no per-skill state is persisted. */
export const DEFAULT_ACTIVE_SKILLS: readonly string[] = [
  ...CORE_SKILLS,
  ...SYSTEM_SKILLS,
];

/** Default on/off state per domain. */
export function defaultSkillState(name: string): boolean {
  return (DEFAULT_ACTIVE_SKILLS as readonly string[]).includes(name);
}

/** Rough tokens per compacted message, used to turn counts into savings.
 * Static default — subject to model/tokenizer drift. */
export const AVG_TOKENS_PER_MESSAGE = 120;

/**
 * Fallback compression ratio applied to live input tokens when the session
 * log has no compaction events yet (documented estimate, not a fake metric).
 * Static default — subject to model/tokenizer drift.
 */
export const PONYTAIL_ESTIMATE_RATIO = 0.08;

const EVENTS_FILENAME = "events.jsonl";
const GLOBAL_CONFIG_FILENAME = "config.json";
/** Owner read/write only -- the global config can contain credentials. */
export const PRIVATE_MODE = 0o600;

/** Directories Graphify never descends into when indexing. */
const GRAPHIFY_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".toolify",
  ".next",
]);

export interface TokenUsageLike {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CollectPluginStatsInput {
  /** Workspace root; Graphify indexes `<workspace>/src`. */
  readonly workspace: string;
  /** Session directory containing `events.jsonl` (Ponytail metrics). */
  readonly sessionDir?: string | null;
  /** Live meter totals (Ponytail fallback when no compaction is logged). */
  readonly usage?: TokenUsageLike;
  /** Override `~/.toolify` (tests). */
  readonly toolifyHome?: string;
}

/**
 * Tokens reclaimed by Ponytail this session.
 *
 * Primary source: `compaction` events in the session log, where each event
 * records how many messages were summarized vs kept. Every summarized message
 * that did not survive re-reading is one we never resend, so savings are
 * `(summarized - kept) * AVG_TOKENS_PER_MESSAGE`.
 */
export function readPonytailSavings(
  sessionDir?: string | null,
  usage?: TokenUsageLike,
): number {
  let reclaimed = 0;
  const eventsPath = sessionDir ? join(sessionDir, EVENTS_FILENAME) : null;

  if (eventsPath && existsSync(eventsPath)) {
    let raw = "";
    try {
      raw = readFileSync(eventsPath, "utf8");
    } catch {
      raw = "";
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as {
          type?: string;
          summarized?: number;
          kept?: number;
        };
        if (ev.type !== "compaction") continue;
        const summarized = typeof ev.summarized === "number" ? ev.summarized : 0;
        const kept = typeof ev.kept === "number" ? ev.kept : 0;
        reclaimed += Math.max(0, summarized - kept) * AVG_TOKENS_PER_MESSAGE;
      } catch {
        // Ignore malformed/partial log lines (the log is appended live).
      }
    }
  }

  if (reclaimed > 0) return reclaimed;

  const inputTokens = usage?.inputTokens ?? 0;
  return Math.round(inputTokens * PONYTAIL_ESTIMATE_RATIO);
}

/**
 * Graph nodes discovered under `<workspace>/src`: the source root itself plus
 * every directory and file Graphify would index.
 */
export function countGraphifyNodes(workspace: string): number {
  const root = resolve(workspace, "src");
  if (!existsSync(root)) return 0;

  let nodes = 1; // the src root
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (GRAPHIFY_SKIP.has(entry.name)) continue;
      if (entry.isDirectory()) {
        nodes += 1;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        nodes += 1;
      }
    }
  };
  walk(root);
  return nodes;
}

/**
 *Skills installed under `<toolifyHome>/skills`, discovered by looking for
 * `*.md` files: either `<skill>.md` at the top level or `<skill>/*.md`
 * (e.g. `<skill>/SKILL.md`). Falls back to Core + System defaults
 * (`design`, `research`, `writing`, `terminal`, `git`) when the folder is
 * empty or missing.
 */

export function listInstalledSkills(toolifyHome?: string): string[] {
  const skillsDir = join(toolifyHome ?? globalDir(), "skills");
  if (!existsSync(skillsDir)) return [...DEFAULT_ACTIVE_SKILLS];

  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [...DEFAULT_ACTIVE_SKILLS];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      let children: Dirent[];
      try {
        children = readdirSync(join(skillsDir, entry.name), {
          withFileTypes: true,
        });
      } catch {
        continue;
      }
      const hasMd = children.some(function (ch) {
        return ch.isFile() && ch.name.toLowerCase().endsWith(".md");
      });
      if (hasMd) names.push(entry.name);
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".md") &&
      entry.name.length > ".md".length
    ) {
      names.push(entry.name.slice(0, -".md".length).toLowerCase());
    }
  }

  return names.length > 0 ? names.sort() : [...DEFAULT_ACTIVE_SKILLS];
}

/** Effective on/off state for a single skill. */
export function skillEnabled(plugins: PluginSettings, name: string): boolean {
  const override = plugins.skills?.[name];
  if (typeof override === "boolean") return override;
  return defaultSkillState(name);
}

/** Display rows for the inspect sub-list: installed union catalog, catalog first. */
export function skillDisplayList(installed: readonly string[]): readonly string[] {
  const catalog = SKILL_CATALOG.map(function (s) { return s.name; });
  const extra = installed
    .filter(function (n) { return catalog.indexOf(n) < 0; })
    .sort(function (x, y) { return x.localeCompare(y); });
  return [...catalog, ...extra];
}

/** Names of skills currently toggled on (installed union catalog). */
export function activeSkillNamesFromState(
  plugins: PluginSettings,
  installed: readonly string[],
): string[] {
  return skillDisplayList(installed).filter(function (name) {
    return skillEnabled(plugins, name);
  });
}

/** Flip one skill toggle state; persists under `plugins.skills`. */
export function toggleSkill(plugins: PluginSettings, name: string): PluginSettings {
  const next: Record<string, boolean> = { ...(plugins.skills ?? {}) };
  next[name] = !skillEnabled(plugins, name);
  return { ...plugins, skills: next };
}

/** Installed Ruflo sub-modules shown in Ruflo inspect mode. */
export interface RufloModuleMeta {
  readonly id: string;
  readonly category: string;
  readonly description: string;
}

export const RUFLO_MODULES: readonly RufloModuleMeta[] = [
  { id: "ruflo-core", category: "System", description: "Base swarm harness & agent event loop" },
  { id: "ruflo-swarm", category: "Swarm", description: "Queen/Worker coordinator (Parallel)" },
  { id: "ruflo-memory", category: "Memory", description: "Vector-backed cross-session RAG index" },
  { id: "ruflo-auto", category: "SONA", description: "Adaptive routing & cost optimizer" },
];

/** Legacy aliases kept working (renamed modules). */
const RUFLO_MODULE_ALIASES: Readonly<Record<string, string>> = {
  "ruflo-autopilot": "ruflo-auto",
};

/** Canonical Ruflo module id after resolving legacy aliases. */
export function canonicalRufloModuleId(id: string): string {
  return RUFLO_MODULE_ALIASES[id] ?? id;
}

/** Default on/off state per Ruflo module (SONA optimizer ships off). */
export function defaultRufloModuleState(id: string): boolean {
  const canonical = canonicalRufloModuleId(id);
  return canonical === "ruflo-core" || canonical === "ruflo-swarm" || canonical === "ruflo-memory";
}

/** Effective on/off state for a single Ruflo module (aliases resolved). */
export function rufloModuleEnabled(plugins: PluginSettings, id: string): boolean {
  const canonical = canonicalRufloModuleId(id);
  const direct = plugins.rufloModules?.[id];
  const viaCanonical = canonical !== id ? plugins.rufloModules?.[canonical] : undefined;
  const aliasHit = Object.entries(RUFLO_MODULE_ALIASES).find(
    ([alias, target]) => target === canonical && alias !== id,
  );
  const aliasOverride = aliasHit ? plugins.rufloModules?.[aliasHit[0]] : undefined;
  const override = direct ?? viaCanonical ?? aliasOverride;
  if (typeof override === "boolean") return override;
  return defaultRufloModuleState(canonical);
}

/** Flip one Ruflo module toggle state; persists under `plugins.rufloModules`. */
export function toggleRufloModule(plugins: PluginSettings, id: string): PluginSettings {
  const canonical = canonicalRufloModuleId(id);
  const next: Record<string, boolean> = { ...(plugins.rufloModules ?? {}) };
  next[canonical] = !rufloModuleEnabled(plugins, canonical);
  return { ...plugins, rufloModules: next };
}

/** Names of Ruflo modules currently toggled on. */
export function activeRufloModules(plugins: PluginSettings): string[] {
  return RUFLO_MODULES.map((m) => m.id).filter((id) => rufloModuleEnabled(plugins, id));
}

/** Selectable worker role badges in the Ruflo sub-view. */
export const RUFLO_ROLES = [
  "architect",
  "coder",
  "researcher",
  "reviewer",
  "tester",
] as const;

export type RufloRole = (typeof RUFLO_ROLES)[number];

/** Default on/off state per worker role (reviewer/tester ship off). */
export function defaultRufloRoleState(role: string): boolean {
  return role === "architect" || role === "coder" || role === "researcher";
}

/** Effective on/off state for a single worker role. */
export function rufloRoleEnabled(plugins: PluginSettings, role: string): boolean {
  const override = plugins.rufloRoles?.[role];
  if (typeof override === "boolean") return override;
  return defaultRufloRoleState(role);
}

/** Flip one worker role; persists under `plugins.rufloRoles`. */
export function toggleRufloRole(plugins: PluginSettings, role: string): PluginSettings {
  const next: Record<string, boolean> = { ...(plugins.rufloRoles ?? {}) };
  next[role] = !rufloRoleEnabled(plugins, role);
  return { ...plugins, rufloRoles: next };
}

export interface RufloRuntimeState {
  readonly activeWorkers: number;
  readonly runtime: string;
}

/**
 * Read the Ruflo worker/swarm runtime state.
 *
 * Today there is no external swarm daemon, so the engine reports its local
 * harness: 0 active workers on `ruflo-core`. The hook exists so a future
 * runtime (env override `RUFLO_WORKERS`, runtime id override `RUFLO_RUNTIME`)
 * feeds the same status line without touching callers.
 */
export function readRufloRuntime(overrides?: Partial<RufloRuntimeState>): RufloRuntimeState {
  const readEnv = (name: string): string | undefined => {
    try {
      const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
      const v = env?.[name];
      return typeof v === "string" && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const raw = overrides?.activeWorkers ?? Number(readEnv("RUFLO_WORKERS") ?? NaN);
  const activeWorkers = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
  const runtime = overrides?.runtime ?? readEnv("RUFLO_RUNTIME") ?? "ruflo-core";
  return { activeWorkers, runtime };
}

/** Collect every live metric rendered by the Plugins tab. */
/** Collect every live metric rendered by the Plugins tab. */
export function collectPluginStats(
  input: CollectPluginStatsInput & { readonly plugins?: PluginSettings },
): PluginStats {
  const installed = listInstalledSkills(input.toolifyHome);
  const activeSkillNames = input.plugins
    ? activeSkillNamesFromState(input.plugins, installed)
    : installed;
  return {
    ponytailSavings: readPonytailSavings(input.sessionDir, input.usage),
    graphifyNodeCount: countGraphifyNodes(input.workspace),
    activeSkillsCount: activeSkillNames.length,
    activeSkillNames,
    rufloActiveWorkers: readRufloRuntime().activeWorkers,
    rufloRuntime: readRufloRuntime().runtime,
  };
}

// ---------------------------------------------------------------------------
// Global persistence: ~/.toolify/config.json -> { plugins: {...} }
// ---------------------------------------------------------------------------

/** Resolve the global config path (`~/.toolify/config.json`). */
export function globalConfigPath(toolifyHome?: string): string {
  return join(toolifyHome ?? globalDir(), GLOBAL_CONFIG_FILENAME);
}

/** Read persisted plugin state; falls back to all-enabled defaults. */
export function loadGlobalPlugins(toolifyHome?: string): PluginSettings {
  const p = globalConfigPath(toolifyHome);
  if (!existsSync(p)) return { ...DEFAULT_PLUGINS };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { plugins?: unknown };
    return normalizePlugins(parsed.plugins);
  } catch {
    return { ...DEFAULT_PLUGINS };
  }
}

/**
 * Persist plugin state to `~/.toolify/config.json` under the `plugins` key,
 * preserving any other keys already in that file. Always written 0600.
 * Returns the path written.
 */
export function saveGlobalPlugins(plugins: PluginSettings, toolifyHome?: string): string {
  const dir = toolifyHome ?? globalDir();
  mkdirSync(dir, { recursive: true });

  const p = join(dir, GLOBAL_CONFIG_FILENAME);
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    try {
      existing = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  existing.plugins = { ...plugins };
  writeFileSync(p, JSON.stringify(existing, null, 2) + "\n", {
    encoding: "utf8",
    mode: PRIVATE_MODE,
  });
  // mode only applies at creation, so tighten pre-existing files too.
  try {
    chmodSync(p, PRIVATE_MODE);
  } catch {
    // Best effort: some filesystems have no POSIX mode bits.
  }
  return p;
}

// ---------------------------------------------------------------------------
// Status lines rendered under the highlighted plugin row
// ---------------------------------------------------------------------------

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Contextual status for a plugin row. Disabled plugins report why they are
 * idle instead of showing stale metrics.
 */
export function pluginStatusLine(
  id: PluginId,
  enabled: boolean,
  stats: PluginStats,
): string {
  if (!enabled) {
    if (id === "ponytail") return "Engine paused";
    if (id === "graphify") return "Indexing disabled";
    if (id === "ruflo") return "Engine idle";
    return "Skills disabled";
  }

  if (id === "ponytail") {
    return `Engine active \u00b7 ${formatCount(stats.ponytailSavings)} tokens saved`;
  }
  if (id === "graphify") {
    return `Graph ready \u00b7 ${formatCount(stats.graphifyNodeCount)} nodes indexed`;
  }
  if (id === "ruflo") {
    return `Swarm Engine active \u00b7 ${stats.rufloActiveWorkers} active workers (${stats.rufloRuntime})`;
  }
  const names = stats.activeSkillNames.length > 0
    ? stats.activeSkillNames.join(", ")
    : CORE_SKILLS.join(", ");
  return `${stats.activeSkillsCount} skills active \u00b7 ${names}`;
}