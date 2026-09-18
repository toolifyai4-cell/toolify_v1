import React from "react";
import { Box, Text, useInput } from "ink";
import type { AgentMode } from "../agent/types.js";
import {
  AUTO_ORDER,
  SETTINGS_MODELS,
  SETTINGS_PROVIDERS,
  SETTINGS_THEMES,
  THEME_LABELS,
  cycleNext,
  type SettingsDraft,
  type AutoApproveMode,
  type SettingsProvider,
  PLUGIN_CATALOG,
  togglePlugin,
  DEFAULT_PLUGIN_STATS,
  type PluginSettings,
  type PluginStats,
} from "./settings.js";
import {
  RUFLO_MODULES,
  RUFLO_ROLES,
  collectPluginStats,
  listInstalledSkills,
  saveGlobalPlugins,
  skillDisplayList,
  toggleRufloModule,
  toggleRufloRole,
  toggleSkill,
} from "./plugins.js";
import { PluginsTab, type PluginsSubView } from "./PluginsTab.js";
import { ProviderModal, PROVIDER_CATALOG, type ProviderCatalogEntry } from "./ProviderModal.js";
import { ProviderConfigModal, type ProviderConfigModalProps } from "./ProviderConfigModal.js";
import { ThemeModal } from "./ThemeModal.js";
import { useTheme } from "../theme/ThemeContext.js";
import { saveApiKey, saveBaseUrl, readConfigSync } from "../utils/config.js";
import { getModelsForProvider, type ProbedModel } from "../models/fetch-models.js";
import { ModelsTab } from "./ModelsTab.js";
import { PROVIDER_NAMES, formatTokenLimit, prettifyModelId, type ModelDescriptor, DEFAULT_CONTEXT_LIMITS } from "../models/model-registry.js";

export type { SettingsDraft };

export interface SettingsMenuProps {
  readonly initial: SettingsDraft;
  /** Persist + close on Esc. Receives the edited draft. */
  readonly onSave: (draft: SettingsDraft) => void;
  /** Close without saving (reserved for future use; Esc always saves). */
  readonly onClose?: () => void;
  /** Live sync: called when Mode toggles inside the menu so the footer updates instantly. */
  readonly onModeChange?: (mode: AgentMode) => void;
  /** Live sync: called when Auto-Approve cycles inside the menu so the footer updates instantly. */
  readonly onAutoApproveChange?: (autoApprove: AutoApproveMode) => void;
  /** Active workspace path (used to read workspace-local .env). */
  readonly workspace: string;
  /** Session directory (events.jsonl) for live Ponytail metrics. */
  readonly sessionDir?: string | null;
  /** Live token meter totals, used when no compaction has been logged. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /** Persist plugin state (defaults to ~/.toolify/config.json at 0600). */
  readonly persistPlugins?: (plugins: PluginSettings) => void;
  /** Tab to open on mount (defaults to General). */
  readonly initialTab?: string;
}

const TABS: readonly string[] = [
  "General", "Skills", "Rules", "Tools", "MCP", "Plugins", "Agents",
];

/** Tab index of the Plugins tab (kept in sync with the TABS order). */
const PLUGINS_TAB_INDEX = TABS.indexOf("Plugins");

type RowId = "provider" | "model" | "mode" | "theme" | "autoApprove" | "autoUpdate";

const GENERAL_ROWS: readonly RowId[] = [
  "provider", "model", "mode", "theme", "autoApprove", "autoUpdate",
];

const LABELS: Record<RowId, string> = {
  provider: "Provider",
  model: "Model",
  mode: "Mode",
  theme: "Theme",
  autoApprove: "Auto-Approve All",
  autoUpdate: "Auto Update",
};

const TOGGLE_ROWS: Record<RowId, boolean> = {
  provider: false,
  model: false,
  mode: true,
  theme: false,
  autoApprove: true,
  autoUpdate: true,
};

/** Tab indexes that support row navigation. */
const NAVIGABLE_TABS = new Set([0, 2, 3, 4]); // General, Skills, Rules, Tools

interface TabRow {
  readonly label: string;
  readonly value: string;
}

const SKILLS_ROWS: readonly TabRow[] = [
  { label: "Code understanding", value: "Parse files, imports & structure" },
  { label: "Planning & reasoning", value: "Step-by-step risk management" },
  { label: "File operations", value: "Search, read & apply precise edits" },
  { label: "Command execution", value: "Run builds/tests & interpret errors" },
  { label: "Verification", value: "Check build, lint & test status" },
  { label: "Context management", value: "Token limits & context truncation" },
  { label: "Safety & control", value: "Plan/Act modes & approval gates" },
];

const RULES_ROWS: readonly TabRow[] = [
  { label: "Plan Mode (Read-Only)", value: "No edits/commands; read & propose only" },
  { label: "Act Mode Approval", value: "No file/command actions without approval" },
  { label: "Workspace Boundary", value: "Restricted to workspace; no sensitive files" },
  { label: "No Hidden Actions", value: "Full transparency; never hide errors" },
  { label: "Token Honesty", value: "No fake usage/costs; direct metrics" },
  { label: "User Control", value: "Instant task abort; respects mode toggles" },
];

const TOOLS_ROWS: readonly TabRow[] = [
  { label: "File System", value: "[ Search, Read, Edit Ranges ]" },
  { label: "Command-Line", value: "[ Build, Test, Lint Commands ]" },
  { label: "Version Control", value: "[ Git Status, Diffs, Commit & Push ]" },
  { label: "Project Navigation", value: "[ Find Symbols & Definitions ]" },
  { label: "Auth & Providers", value: "[ Google/GitHub, .env Models ]" },
];

/** Clip a description so a row never overflows the modal width. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 3)) + "...";
}

function providerLabel(p: string): string {
  return p === "openai" ? "OpenAI"
    : p === "anthropic" ? "Anthropic"
    : p === "gemini" ? "Gemini"
    : p === "groq" ? "Groq"
    : p === "ollama" ? "Ollama"
    : p === "openrouter" ? "OpenRouter"
    : p;
}

function valueFor(row: RowId, draft: SettingsDraft): string {
  switch (row) {
    case "provider": return providerLabel(draft.provider);
    case "model": return draft.model;
    case "mode": return draft.mode === "plan" ? "Plan" : "Build";
    case "theme": return THEME_LABELS[draft.theme] ?? draft.theme;
    case "autoApprove": return draft.autoApprove === "off" ? "off" : draft.autoApprove === "writes" ? "writes" : "all";
    case "autoUpdate": return draft.autoUpdate ? "on" : "off";
  }
}

function isToggleOn(row: RowId, draft: SettingsDraft): boolean {
  switch (row) {
    case "mode": return draft.mode === "act";
    case "autoApprove": return draft.autoApprove !== "off";
    case "autoUpdate": return draft.autoUpdate;
    default: return false;
  }
}

function hintFor(row: RowId): string {
  switch (row) {
    case "mode": return "(Plan / Build)";
    case "autoApprove": return "(Prompt / Auto)";
    default: return "";
  }
}

interface ModelPickerModalProps {
  readonly models: readonly ModelDescriptor[];
  readonly activeModel: string;
  readonly activeProviderId: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly isActive?: boolean;
  readonly onCommit: (modelId: string, providerId: string) => void;
  readonly onClose: () => void;
}

/** Modal wrapper around ModelsTab for the settings model picker. */
function ModelPickerModal(props: ModelPickerModalProps): React.ReactElement {
  const { tokens } = useTheme();
  return (
    <Box width="100%" height={20} justifyContent="center" alignItems="center">
      <Box
        borderStyle="round"
        borderColor={tokens.border}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={78}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>Select Model</Text>
          <Text dimColor>[Esc] Close</Text>
        </Box>
        <Box height={1} />
        <ModelsTab
          models={props.models}
          activeModel={props.activeModel}
          activeProviderId={props.activeProviderId}
          loading={props.loading}
          isActive={props.isActive ?? true}
          onCommit={props.onCommit}
          onClose={props.onClose}
        />
      </Box>
    </Box>
  );
}

/**
 * Polished floating settings overlay. Renders inline above the input bar in
 * ChatUI (never a full-screen takeover). Owns its own `useInput` so typed
 * navigation keys stay isolated from the prompt field. Left/Right cycle the
 * 8-tab bar; Up/Down move the row cursor; Space/Enter toggle/cycle the
 * selected value; Esc saves the draft and closes.
 */
export function SettingsMenu(props: SettingsMenuProps): React.ReactElement {
  const [draft, setDraft] = React.useState<SettingsDraft>(props.initial);
  const [selectedTab, setSelectedTab] = React.useState(() => {
    const i = props.initialTab ? TABS.indexOf(props.initialTab) : 0;
    return i >= 0 ? i : 0;
  });
  const [selectedRow, setSelectedRow] = React.useState(0);
  const [providerModalOpen, setProviderModalOpen] = React.useState(false);
  const [configModalOpen, setConfigModalOpen] = React.useState(false);
  const [pendingProvider, setPendingProvider] = React.useState<SettingsProvider | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [modelPickerModels, setModelPickerModels] = React.useState<ModelDescriptor[]>([]);
  const [modelPickerLoading, setModelPickerLoading] = React.useState(false);
  const [modelPickerError, setModelPickerError] = React.useState<string | null>(null);
  const [pluginStats, setPluginStats] = React.useState<PluginStats>(DEFAULT_PLUGIN_STATS);
  const [activeSubView, setActiveSubView] = React.useState<PluginsSubView>("main");
  const [inspectIndex, setInspectIndex] = React.useState(0);
  /** Interactive theme picker overlay (opened from the Theme row). */
  const [themeModalOpen, setThemeModalOpen] = React.useState(false);
  /** Active color tokens + active theme — every Ink color prop below reads from here. */
  const { tokens, theme } = useTheme();

  // Keep the editable draft aligned with the globally persisted theme so that
  // saving settings never writes a stale theme id back to disk.
  React.useEffect(() => {
    setDraft((d) => (d.theme === theme.id ? d : { ...d, theme: theme.id }));
  }, [theme.id]);

  /** Write plugin state to ~/.toolify/config.json (0600) immediately. */
  const persistPlugins = React.useCallback(
    (plugins: PluginSettings) => {
      const write = props.persistPlugins ?? saveGlobalPlugins;
      try {
        write(plugins);
      } catch {
        // A failed write must never tear down the modal.
      }
    },
    [props.persistPlugins],
  );

  /** Re-read live plugin metrics (session log, workspace scan, skills dir). */
  const refreshPluginStats = React.useCallback(() => {
    setPluginStats(
      collectPluginStats({
        workspace: props.workspace,
        sessionDir: props.sessionDir ?? null,
        usage: props.usage,
        plugins: draftRef.current.plugins,
      }),
    );
  }, [props.workspace, props.sessionDir, props.usage]);

  // Refresh metrics whenever the Plugins tab becomes active.
  React.useEffect(() => {
    if (selectedTab === PLUGINS_TAB_INDEX) refreshPluginStats();
  }, [selectedTab, refreshPluginStats]);
  const savedRef = React.useRef(false);
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const save = React.useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    props.onSave(draftRef.current);
  }, [props]);

  /** Check if a provider has a configured API key (from config.json or env). */
  function isProviderConfiguredSync(providerId: SettingsProvider, workspace: string): boolean {
    try {
      const cfg = readConfigSync();
      const key = cfg.apiKeys[providerId];
      if (key && key.trim().length > 0) return true;
      // Also check environment variables
      const envVars: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        gemini: "GEMINI_API_KEY",
        groq: "GROQ_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
        perplexity: "PERPLEXITY_API_KEY",
        omniroute: "OMNIROUTE_API_KEY",
        unoroute: "UNOROUTE_API_KEY",
        litellm: "LITELLM_API_KEY",
        ollama: "OLLAMA_API_KEY",
      };
      const envVar = envVars[providerId];
      if (envVar && process.env[envVar]) return true;
    } catch {
      // Ignore errors, treat as unconfigured
    }
    return false;
  }

  const providerCatalog = React.useMemo(() => {
    return PROVIDER_CATALOG.map((p) => ({
      ...p,
      isCurrent: p.id === draft.provider,
      isConfigured: isProviderConfiguredSync(p.id, props.workspace),
    }));
  }, [draft.provider, props.workspace]);

  const onProviderSelect = React.useCallback(
    (provider: SettingsProvider, defaultModel: string) => {
      setPendingProvider(provider);
      setProviderModalOpen(false);
      setConfigModalOpen(true);
    },
    [],
  );

  const onProviderConfigConfirm = React.useCallback(
    (provider: SettingsProvider, apiKey: string, baseUrl: string) => {
      const models = SETTINGS_MODELS[provider];
      setDraft((d) => ({ ...d, provider, model: models[0]! }));
      // The modal only calls confirm AFTER live verification succeeded, so
      // this key is validated — persist it to ~/.toolify/config.json. The
      // modal stays open on its success pane until Enter/Esc closes it.
      void saveApiKey(provider, apiKey).catch(() => {
        // A failed write must never tear down the modal; the verified key
        // still applies to the current session draft.
      });
      if (baseUrl.trim()) {
        void saveBaseUrl(provider, baseUrl.trim()).catch(() => {});
      }
    },
    [],
  );

  const onProviderConfigCancel = React.useCallback(() => {
    setPendingProvider(null);
    setConfigModalOpen(false);
  }, []);

  /** Fetch live models for the current provider and open the model picker modal. */
  const openModelPicker = React.useCallback(async () => {
    const provider = draft.provider;
    setModelPickerLoading(true);
    setModelPickerError(null);
    setModelPickerModels([]);
    
    try {
      // Resolve API key and base URL for the provider
      const cfg = readConfigSync();
      const apiKey = cfg.apiKeys[provider];
      const baseUrl = cfg.baseUrls[provider];
      
      if (!apiKey && provider !== "ollama") {
        // For providers that need API keys, show fallback models
        setModelPickerError("No API key configured. Showing fallback models.");
      }
      
      const result = await getModelsForProvider(provider, apiKey ?? "", { baseUrl });
      
      // Convert ProbedModel[] to ModelDescriptor[]
      const defaultLimit = DEFAULT_CONTEXT_LIMITS[provider];
      const providerName = PROVIDER_NAMES[provider] ?? provider;
      
      const descriptors: ModelDescriptor[] = result.models.map((m) => {
        const hasLiveContext = typeof m.contextTokens === "number" && m.contextTokens > 0;
        return {
          id: m.id,
          displayName: prettifyModelId(m.id),
          providerId: provider,
          providerName,
          contextLimit: hasLiveContext
            ? formatTokenLimit(m.contextTokens)
            : defaultLimit
            ? formatTokenLimit(defaultLimit.tokens)
            : "N/A",
          contextLimitEstimate: !hasLiveContext && !!defaultLimit,
          ...(m.isFree ? { isFree: true } : {}),
          ...(m.isFallback ? { isFallback: true, fetchedAt: m.fetchedAt } : {}),
        };
      });
      
      setModelPickerModels(descriptors);
    } catch (err) {
      setModelPickerError(err instanceof Error ? err.message : "Failed to fetch models");
      // Still open with empty list - ModelsTab will show fallback notice
      setModelPickerModels([]);
    } finally {
      setModelPickerLoading(false);
      setModelPickerOpen(true);
    }
  }, [draft.provider, props.workspace]);

  const onModelPickerCommit = React.useCallback(
    (modelId: string, providerId: string) => {
      setDraft((d) => ({ ...d, model: modelId, provider: providerId as SettingsProvider }));
      setModelPickerOpen(false);
    },
    [],
  );

  const onModelPickerClose = React.useCallback(() => {
    setModelPickerOpen(false);
    setModelPickerModels([]);
    setModelPickerError(null);
  }, []);

  function currentRowCount(): number {
    switch (selectedTab) {
      case 0: return GENERAL_ROWS.length;
      case 1: return SKILLS_ROWS.length;
      case 2: return RULES_ROWS.length;
      case 3: return TOOLS_ROWS.length;
      case PLUGINS_TAB_INDEX: return PLUGIN_CATALOG.length;
      default: return 0;
    }
  }

  useInput((ch, key) => {
    // --- Plugins sub-view (tier 2/3): scoped navigation, tab bar hidden ---
    const inPluginsSubView =
      selectedTab === PLUGINS_TAB_INDEX && activeSubView !== "main";
    if (inPluginsSubView) {
      // Strict tier isolation: horizontal navigation and Tab switching are
      // swallowed while a drill-down is open.
      if (key.leftArrow || key.rightArrow || key.tab || (key.tab && key.shift)) {
        return;
      }
      const count =
        activeSubView === "agentSkills"
          ? skillDisplayList(listInstalledSkills()).length
          : activeSubView === "ruflo"
            ? RUFLO_MODULES.length + RUFLO_ROLES.length
            : 0;
      if (key.upArrow) {
        setInspectIndex((v) => (v - 1 + Math.max(count, 1)) % Math.max(count, 1));
        return;
      }
      if (key.downArrow) {
        setInspectIndex((v) => (v + 1) % Math.max(count, 1));
        return;
      }
      if (ch === " ") {
        if (activeSubView === "ruflo") {
          const plugins =
            inspectIndex < RUFLO_MODULES.length
              ? toggleRufloModule(draft.plugins, RUFLO_MODULES[inspectIndex]!.id)
              : toggleRufloRole(draft.plugins, RUFLO_ROLES[inspectIndex - RUFLO_MODULES.length]!);
          setDraft((d) => ({ ...d, plugins }));
          persistPlugins(plugins);
          refreshPluginStats();
        } else if (activeSubView === "agentSkills") {
          const names = skillDisplayList(listInstalledSkills());
          const target = names[inspectIndex];
          if (target) {
            const plugins = toggleSkill(draft.plugins, target);
            setDraft((d) => ({ ...d, plugins }));
            persistPlugins(plugins);
            refreshPluginStats();
          }
        }
        return;
      }
      if (key.return || key.escape) {
        // Enter/Esc inside a drill-down returns to the main list; the parent
        // row cursor (selectedRow) was never moved, so focus is restored.
        setActiveSubView("main");
        return;
      }
      return;
    }

    if (key.leftArrow || (key.tab && key.shift)) {
      setSelectedTab((t) => (t - 1 + TABS.length) % TABS.length);
      setSelectedRow(0);
      return;
    }
    if (key.rightArrow || key.tab) {
      setSelectedTab((t) => (t + 1) % TABS.length);
      setSelectedRow(0);
      return;
    }
    const count = currentRowCount();
    if (count > 0) {
      if (key.upArrow) { setSelectedRow((s) => (s - 1 + count) % count); return; }
      if (key.downArrow) { setSelectedRow((s) => (s + 1) % count); return; }
    }
    if (selectedTab === 0 && (key.return || ch === " ")) {
      const row = GENERAL_ROWS[selectedRow]!;
      if (row === "provider") {
        setProviderModalOpen(true);
        return;
      }
      if (row === "model") {
        openModelPicker();
        return;
      }
      if (row === "theme") {
        setThemeModalOpen(true);
        return;
      }
      setDraft((d) => {
        switch (row) {
          case "mode": {
            const next: AgentMode = d.mode === "plan" ? "act" : "plan";
            props.onModeChange?.(next);
            return { ...d, mode: next };
          }
          case "autoApprove": {
            const next = cycleNext(AUTO_ORDER, d.autoApprove);
            props.onAutoApproveChange?.(next);
            return { ...d, autoApprove: next };
          }
          case "autoUpdate":
            return { ...d, autoUpdate: !d.autoUpdate };
        }
      });
    }
    if (selectedTab === PLUGINS_TAB_INDEX) {
      // Sub-views never reach here: the scoped block above consumes all input
      // while a drill-down is open. Only the main list is handled below.
      if (key.return) {
        const plugin = PLUGIN_CATALOG[selectedRow];
        if (plugin && (plugin.id === "agentSkills" || plugin.id === "ruflo")) {
          setActiveSubView(plugin.id);
          setInspectIndex(0);
          return;
        }
      }
      if (ch === " ") {
        const plugin = PLUGIN_CATALOG[selectedRow];
        if (plugin) {
          const plugins = togglePlugin(draft.plugins, plugin.id);
          setDraft((d) => ({ ...d, plugins }));
          persistPlugins(plugins);
          refreshPluginStats();
        }
        return;
      }
      if (key.escape) {
        persistPlugins(draftRef.current.plugins);
        save();
        return;
      }
      return;
    }
    if (key.escape) {
      persistPlugins(draftRef.current.plugins);
      save();
      return;
    }
  }, { isActive: !providerModalOpen && !configModalOpen && !modelPickerOpen && !themeModalOpen });

  // Keep the model valid if the provider changes elsewhere mid-session.
  React.useEffect(() => {
    setDraft((d) => {
      const models = SETTINGS_MODELS[d.provider];
      return models.includes(d.model) ? d : { ...d, model: models[0]! };
    });
  }, []);

  const renderGeneralRow = (r: RowId, i: number) => {
    const rowActive = i === selectedRow;
    const rIsOn = isToggleOn(r, draft);
    const rValue = valueFor(r, draft);
    const rIsToggle = TOGGLE_ROWS[r];
    const valueStr = rIsToggle
      ? `${rIsOn ? "● " : "○ "}${rValue}`
      : rValue;
    return (
      <Box
        key={r}
        flexDirection="row"
        height={1}
        marginBottom={1}
        width="100%"
        justifyContent="space-between"
        backgroundColor={rowActive ? tokens.primary : undefined}
        paddingX={1}
      >
        <Box flexDirection="row">
          <Text bold color={rowActive ? "black" : undefined}>
            {rowActive ? "▸ " : "  "}
          </Text>
          <Text bold color={rowActive ? "black" : "white"}>
            {LABELS[r]}
          </Text>
        </Box>
        <Text
          bold
          color={
            rowActive
              ? "black"
              : rIsOn
                ? "green"
                : rIsToggle
                  ? "gray"
                  : "cyan"
          }
        >
          {"[ "}
          {valueStr}
          {" ]"}
        </Text>
      </Box>
    );
  };

  const renderTabRow = (rows: readonly TabRow[], i: number) => {
    const rowActive = i === selectedRow;
    const item = rows[i]!;
    return (
      <Box
        key={item.label}
        flexDirection="row"
        height={1}
        marginBottom={1}
        width="100%"
        justifyContent="space-between"
        backgroundColor={rowActive ? tokens.primary : undefined}
        paddingX={1}
      >
        <Box flexDirection="row">
          <Text bold color={rowActive ? "black" : undefined}>
            {rowActive ? "▸ " : "  "}
          </Text>
          <Text bold color={rowActive ? "black" : "white"}>
            {item.label}
          </Text>
        </Box>
        <Text
          bold
          color={rowActive ? "black" : "cyan"}
        >
          {item.value}
        </Text>
      </Box>
    );
  };

  const renderPluginsTab = () => (
    <PluginsTab
      plugins={draft.plugins}
      selectedIndex={selectedRow}
      stats={pluginStats}
      activeSubView={activeSubView}
      inspectIndex={inspectIndex}
    />
  );

  const renderComingSoon = () => (
    <Box flexDirection="column" justifyContent="center" alignItems="center" paddingY={2}>
      <Box height={1} />
      <Text bold color={tokens.primary}>[ Coming Soon ]</Text>
      <Box height={1} />
      <Text dimColor>We are actively working on this feature!</Text>
      <Box height={1} />
    </Box>
  );

  const renderTabContent = () => {
    switch (selectedTab) {
      case 0:
        return GENERAL_ROWS.map((r, i) => renderGeneralRow(r, i));
      case 1:
        return SKILLS_ROWS.map((_, i) => renderTabRow(SKILLS_ROWS, i));
      case 2:
        return RULES_ROWS.map((_, i) => renderTabRow(RULES_ROWS, i));
      case 3:
        return TOOLS_ROWS.map((_, i) => renderTabRow(TOOLS_ROWS, i));
      case PLUGINS_TAB_INDEX:
        return renderPluginsTab();
      default:
        return renderComingSoon();
    }
  };

  return (
    <Box width="100%" height={20} justifyContent="center" alignItems="center">
      {configModalOpen && pendingProvider ? (
        <ProviderConfigModal
          providerId={pendingProvider}
          providerName={
            PROVIDER_CATALOG.find((p) => p.id === pendingProvider)?.name ?? pendingProvider
          }
          defaultModel={SETTINGS_MODELS[pendingProvider]![0]!}
          needsBaseUrl={
            (pendingProvider as string) === "ollama" ||
            (pendingProvider as string) === "lmstudio" ||
            (pendingProvider as string) === "vllm" ||
            (pendingProvider as string) === "litellm" ||
            (pendingProvider as string) === "omniroute" ||
            (pendingProvider as string) === "unoroute" ||
            (pendingProvider as string) === "jan"
          }
          guidanceText={
            (pendingProvider as string) === "ollama"
              ? "Ollama runs models locally. No API key required, but ensure Ollama is running."
              : (pendingProvider as string) === "lmstudio"
              ? "LM Studio serves models locally via its OpenAI-compatible endpoint."
              : (pendingProvider as string) === "vllm"
              ? "vLLM serves models locally via its OpenAI-compatible endpoint."
              : `Enter your ${pendingProvider} API key to continue.`
          }
          obtainUrl={
            pendingProvider === "anthropic" ? "https://console.anthropic.com/settings/keys"
            : pendingProvider === "openai" ? "https://platform.openai.com/api-keys"
            : pendingProvider === "gemini" ? "https://ai.google.dev"
            : pendingProvider === "groq" ? "https://console.groq.com/keys"
            : pendingProvider === "openrouter" ? "https://openrouter.ai/settings/keys"
            : pendingProvider === "perplexity" ? "https://perplexity.ai/settings/api"
            : `https://console.${pendingProvider}.com`
          }
          workspace={props.workspace}
          onConfirm={onProviderConfigConfirm}
          onCancel={onProviderConfigCancel}
        />
      ) : providerModalOpen ? (
        <ProviderModal
          providers={providerCatalog}
          currentIndex={providerCatalog.findIndex((p) => p.id === draft.provider)}
          onSelect={onProviderSelect}
          onClose={() => setProviderModalOpen(false)}
        />
      ) : modelPickerOpen ? (
        <ModelPickerModal
          models={modelPickerModels}
          activeModel={draft.model}
          activeProviderId={draft.provider}
          loading={modelPickerLoading}
          error={modelPickerError}
          onCommit={onModelPickerCommit}
          onClose={onModelPickerClose}
        />
      ) : themeModalOpen ? (
        <ThemeModal isOpen={themeModalOpen} onClose={() => setThemeModalOpen(false)} />
      ) : (
      <Box
        borderStyle="round"
        borderColor={tokens.border}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={78}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color={tokens.primary}>
            {selectedTab === PLUGINS_TAB_INDEX && activeSubView !== "main"
              ? "Plugins"
              : "Settings"}
          </Text>
          <Text dimColor>
            {selectedTab === PLUGINS_TAB_INDEX && activeSubView !== "main"
              ? "[Esc] Back"
              : "[Esc] Close"}
          </Text>
        </Box>
        <Box height={1} />
        {selectedTab === PLUGINS_TAB_INDEX && activeSubView !== "main" ? null : (
        <Box flexDirection="row" paddingX={1}>
          {TABS.map((tab, i) => {
            const isActive = i === selectedTab;
            return (
              <Text
                key={tab}
                backgroundColor={isActive ? tokens.primary : undefined}
                color={isActive ? tokens.textInverted : tokens.textMuted}
                bold={isActive}
              >
                {" "}
                {tab}
                {" "}
              </Text>
            );
          })}
        </Box>
        )}
        <Box height={1} />
        <Box flexDirection="column" paddingX={1}>
          {renderTabContent()}
        </Box>
        <Box height={1} />
        <Box paddingX={1}>
          <Text dimColor>
            {selectedTab === PLUGINS_TAB_INDEX && activeSubView === "ruflo"
              ? "Up/Down select, Space toggle badges, Enter/Esc back, Esc close"
              : selectedTab === PLUGINS_TAB_INDEX && activeSubView === "agentSkills"
                ? "Up/Down select skill, Space toggle, Enter/Esc back, Esc close"
                : selectedTab === PLUGINS_TAB_INDEX
                  ? "Up/Down select, Space toggle, Enter inspect, Esc close"
                  : "Left/Right tabs, Up/Down navigate, Space toggle, Esc save & close"}
          </Text>
        </Box>
      </Box>
      )}
    </Box>
  );
}
