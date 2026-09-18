import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AVG_TOKENS_PER_MESSAGE,
  CORE_SKILLS,
  DEFAULT_ACTIVE_SKILLS,
  PONYTAIL_ESTIMATE_RATIO,
  PRIVATE_MODE,
  SKILL_CATALOG,
  activeSkillNamesFromState,
  collectPluginStats,
  countGraphifyNodes,
  defaultSkillState,
  globalConfigPath,
  listInstalledSkills,
  loadGlobalPlugins,
  pluginStatusLine,
  readPonytailSavings,
  saveGlobalPlugins,
  skillDisplayList,
  skillEnabled,
  toggleSkill,
} from "../src/components/plugins.js";
import {
  DEFAULT_PLUGINS,
  PLUGIN_CATALOG,
  normalizePlugins,
  togglePlugin,
} from "../src/components/settings.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `toolify-${prefix}-`));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Plugin catalog
// ---------------------------------------------------------------------------

describe("PLUGIN_CATALOG", () => {
  it("ships exactly the four active plugins with their descriptions", () => {
    expect(PLUGIN_CATALOG.map((p) => p.id)).toEqual([
      "ponytail",
      "graphify",
      "agentSkills",
      "ruflo",
    ]);
    expect(PLUGIN_CATALOG.map((p) => p.name)).toEqual([
      "Ponytail",
      "Graphify",
      "Agent Skills",
      "Ruflo",
    ]);
    expect(PLUGIN_CATALOG[0]!.description).toBe("Optimizes token usage without losing accuracy");
    expect(PLUGIN_CATALOG[1]!.description).toBe(
      "Turns codebase into a knowledge graph to prevent re-reading files",
    );
    expect(PLUGIN_CATALOG[2]!.description).toBe(
      "Activates targeted task phases (Design, Research, Writing)",
    );
    expect(PLUGIN_CATALOG[3]!.description).toBe(
      "Multi-agent swarm orchestration, vector memory & parallel tool execution",
    );
  });

  it("does not list OmniRoute (it is a provider, not a plugin)", () => {
    expect(PLUGIN_CATALOG.some((p) => /omniroute/i.test(p.name))).toBe(false);
    expect(PLUGIN_CATALOG.some((p) => /omniroute/i.test(p.id))).toBe(false);
  });
});

describe("plugin state helpers", () => {
  it("defaults every plugin to enabled", () => {
    expect(DEFAULT_PLUGINS).toEqual({
      ponytail: true,
      graphify: true,
      agentSkills: true,
      ruflo: true,
    });
  });

  it("normalizePlugins only treats an explicit false as disabled", () => {
    expect(normalizePlugins(undefined)).toEqual(DEFAULT_PLUGINS);
    expect(normalizePlugins({ graphify: false })).toEqual({
      ponytail: true,
      graphify: false,
      agentSkills: true,
      ruflo: true,
    });
    expect(normalizePlugins({ ponytail: "nope" })).toEqual(DEFAULT_PLUGINS);
  });

  it("normalizePlugins round-trips per-skill and ruflo module state", () => {
    expect(
      normalizePlugins({
        ruflo: false,
        skills: { database: true },
        rufloModules: { "ruflo-autopilot": true },
      }),
    ).toEqual({
      ponytail: true,
      graphify: true,
      agentSkills: true,
      ruflo: false,
      skills: { database: true },
      rufloModules: { "ruflo-autopilot": true },
    });
  });

  it("togglePlugin flips a single id", () => {
    const next = togglePlugin(DEFAULT_PLUGINS, "graphify");
    expect(next.graphify).toBe(false);
    expect(next.ponytail).toBe(true);
    expect(togglePlugin(next, "graphify").graphify).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ponytail: live compression metrics from session state / token context
// ---------------------------------------------------------------------------

describe("readPonytailSavings", () => {
  function sessionWith(lines: string[]): string {
    const base = tmp("ponytail");
    const sessionDir = join(base, "s_demo");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "events.jsonl"), lines.join("\n"), "utf8");
    return sessionDir;
  }

  it("derives savings from compaction events and ignores malformed lines", () => {
    const sessionDir = sessionWith([
      JSON.stringify({ type: "session_start", model: "gpt-4o", ts: 1 }),
      JSON.stringify({ type: "compaction", summarized: 12, kept: 4, ts: 2 }),
      "{ truncated line",
      JSON.stringify({ type: "compaction", summarized: 3, kept: 1, ts: 3 }),
    ]);
    // (12-4) + (3-1) = 10 summarized-away messages
    expect(readPonytailSavings(sessionDir)).toBe(10 * AVG_TOKENS_PER_MESSAGE);
  });

  it("never reports negative savings when kept exceeds summarized", () => {
    const sessionDir = sessionWith([
      JSON.stringify({ type: "compaction", summarized: 2, kept: 9, ts: 1 }),
    ]);
    expect(readPonytailSavings(sessionDir)).toBe(0);
  });

  it("falls back to the live token context when no compaction is logged", () => {
    const sessionDir = sessionWith([JSON.stringify({ type: "session_start", ts: 1 })]);
    expect(readPonytailSavings(sessionDir, { inputTokens: 10_000, outputTokens: 0 })).toBe(
      Math.round(10_000 * PONYTAIL_ESTIMATE_RATIO),
    );
    expect(readPonytailSavings(null, { inputTokens: 2_500, outputTokens: 0 })).toBe(200);
  });

  it("returns zero when there is neither a log nor usage", () => {
    expect(readPonytailSavings(null)).toBe(0);
    expect(readPonytailSavings(join(tmp("missing"), "nope"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Graphify: real workspace node count
// ---------------------------------------------------------------------------

describe("countGraphifyNodes", () => {
  it("counts the src root, its directories and its files", () => {
    const ws = tmp("graphify");
    mkdirSync(join(ws, "src", "agent"), { recursive: true });
    mkdirSync(join(ws, "src", "cli"), { recursive: true });
    writeFileSync(join(ws, "src", "index.ts"), "export {};\n", "utf8");
    writeFileSync(join(ws, "src", "cli", "run.ts"), "export {};\n", "utf8");

    // src + agent + cli + index.ts + run.ts
    expect(countGraphifyNodes(ws)).toBe(5);
  });

  it("skips build/dependency directories", () => {
    const ws = tmp("graphify-skip");
    mkdirSync(join(ws, "src", "node_modules", "dep"), { recursive: true });
    mkdirSync(join(ws, "src", "dist"), { recursive: true });
    mkdirSync(join(ws, "src", ".git"), { recursive: true });
    writeFileSync(join(ws, "src", "a.ts"), "export {};\n", "utf8");
    writeFileSync(join(ws, "src", "node_modules", "dep", "index.js"), "", "utf8");

    expect(countGraphifyNodes(ws)).toBe(2); // src + a.ts
  });

  it("returns 0 when the workspace has no src directory", () => {
    expect(countGraphifyNodes(tmp("graphify-empty"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Agent Skills: ~/.toolify/skills scan
// ---------------------------------------------------------------------------

describe("listInstalledSkills", () => {
  it("falls back to Core + System defaults when nothing is installed", () => {
    expect(listInstalledSkills(tmp("no-skills"))).toEqual([
      "design",
      "research",
      "writing",
      "terminal",
      "git",
    ]);
    expect([...CORE_SKILLS]).toEqual(["design", "research", "writing"]);
    expect([...DEFAULT_ACTIVE_SKILLS]).toEqual([
      "design",
      "research",
      "writing",
      "terminal",
      "git",
    ]);
  });

  it("counts directories that contain any .md file and ignores the rest", () => {
    const home = tmp("skills");
    mkdirSync(join(home, "skills", "design"), { recursive: true });
    mkdirSync(join(home, "skills", "writing"), { recursive: true });
    mkdirSync(join(home, "skills", "not-a-skill"), { recursive: true });
    writeFileSync(join(home, "skills", "design", "SKILL.md"), "# design\n", "utf8");
    writeFileSync(join(home, "skills", "writing", "SKILL.md"), "# writing\n", "utf8");

    expect(listInstalledSkills(home)).toEqual(["design", "writing"]);
  });

  it("picks up a flat skill.md at the skills root", () => {
    const home = tmp("skills-flat");
    mkdirSync(join(home, "skills"), { recursive: true });
    writeFileSync(join(home, "skills", "skill.md"), "# core\n", "utf8");
    expect(listInstalledSkills(home)).toEqual(["skill"]);
  });
});

// ---------------------------------------------------------------------------
// collectPluginStats
// ---------------------------------------------------------------------------

describe("collectPluginStats", () => {
  it("combines session, workspace and skills metrics", () => {
    const root = tmp("stats");
    const sessionDir = join(root, "s1");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "events.jsonl"),
      JSON.stringify({ type: "compaction", summarized: 5, kept: 1, ts: 1 }),
      "utf8",
    );

    mkdirSync(join(root, "ws", "src"), { recursive: true });
    writeFileSync(join(root, "ws", "src", "a.ts"), "export {};\n", "utf8");

    const home = join(root, "home");
    mkdirSync(join(home, "skills", "research"), { recursive: true });
    writeFileSync(join(home, "skills", "research", "SKILL.md"), "# research\n", "utf8");

    const stats = collectPluginStats({
      workspace: join(root, "ws"),
      sessionDir,
      usage: { inputTokens: 1, outputTokens: 1 },
      toolifyHome: home,
    });

    expect(stats.ponytailSavings).toBe(4 * AVG_TOKENS_PER_MESSAGE);
    expect(stats.graphifyNodeCount).toBe(2); // src + a.ts
    expect(stats.activeSkillsCount).toBe(1);
    expect(stats.activeSkillNames).toEqual(["research"]);
  });
});

// ---------------------------------------------------------------------------
// Global persistence: ~/.toolify/config.json { plugins } @ 0600
// ---------------------------------------------------------------------------

describe("plugin persistence", () => {
  it("defaults to all-enabled when no global config exists", () => {
    expect(loadGlobalPlugins(tmp("no-config"))).toEqual(DEFAULT_PLUGINS);
    expect(globalConfigPath("/home/u/.toolify")).toBe(
      join("/home/u/.toolify", "config.json"),
    );
  });

  it("writes plugin state under the plugins key and reads it back", () => {
    const home = tmp("persist");
    const written = saveGlobalPlugins(togglePlugin(DEFAULT_PLUGINS, "graphify"), home);

    expect(written).toBe(globalConfigPath(home));
    const parsed = JSON.parse(readFileSync(written, "utf8")) as {
      plugins: Record<string, boolean>;
    };
    expect(parsed.plugins).toEqual({
      ponytail: true,
      graphify: false,
      agentSkills: true,
      ruflo: true,
    });
    expect(loadGlobalPlugins(home)).toEqual({
      ponytail: true,
      graphify: false,
      agentSkills: true,
      ruflo: true,
    });
  });

  it("preserves unrelated keys already in the global config", () => {
    const home = tmp("persist-keep");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ telemetry: false, plugins: { ponytail: false } }),
      "utf8",
    );

    saveGlobalPlugins({ ponytail: true, graphify: true, agentSkills: false, ruflo: true }, home);
    const parsed = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(parsed.telemetry).toBe(false);
    expect(parsed.plugins).toEqual({
      ponytail: true,
      graphify: true,
      agentSkills: false,
      ruflo: true,
    });
  });

  it.skipIf(process.platform === "win32")("writes the global config as 0600", () => {
    const home = tmp("persist-mode");
    saveGlobalPlugins(DEFAULT_PLUGINS, home);
    const mode = statSync(globalConfigPath(home)).mode & 0o777;
    expect(mode).toBe(PRIVATE_MODE);
    expect(PRIVATE_MODE).toBe(0o600);
  });

  it("tightens an existing world-readable global config", () => {
    const home = tmp("persist-tighten");
    mkdirSync(home, { recursive: true });
    const p = join(home, "config.json");
    writeFileSync(p, "{}", { encoding: "utf8", mode: 0o666 });
    saveGlobalPlugins(DEFAULT_PLUGINS, home);
    // chmod is best-effort on Windows; on POSIX the mode must be tightened.
    if (process.platform !== "win32") {
      expect(statSync(p).mode & 0o777).toBe(PRIVATE_MODE);
    } else {
      expect(readFileSync(p, "utf8")).toContain("plugins");
    }
  });
});

// ---------------------------------------------------------------------------
// Contextual status lines
// ---------------------------------------------------------------------------

describe("pluginStatusLine", () => {
  const stats = {
    ponytailSavings: 12_480,
    graphifyNodeCount: 342,
    activeSkillsCount: 3,
    activeSkillNames: ["design", "research", "writing"],
    rufloActiveWorkers: 0,
    rufloRuntime: "ruflo-core",
  };

  it("reports live metrics while enabled", () => {
    expect(pluginStatusLine("ponytail", true, stats)).toBe(
      "Engine active \u00b7 12,480 tokens saved",
    );
    expect(pluginStatusLine("graphify", true, stats)).toBe(
      "Graph ready \u00b7 342 nodes indexed",
    );
    expect(pluginStatusLine("agentSkills", true, stats)).toBe(
      "3 skills active \u00b7 design, research, writing",
    );
    expect(pluginStatusLine("ruflo", true, stats)).toBe(
      "Swarm Engine active \u00b7 0 active workers (ruflo-core)",
    );
  });

  it("explains why a disabled plugin is idle", () => {
    expect(pluginStatusLine("ponytail", false, stats)).toBe("Engine paused");
    expect(pluginStatusLine("graphify", false, stats)).toBe("Indexing disabled");
    expect(pluginStatusLine("agentSkills", false, stats)).toBe("Skills disabled");
    expect(pluginStatusLine("ruflo", false, stats)).toBe("Engine idle");
  });

    it("falls back to Core + System defaults when names are unavailable", () => {
    const empty = { ...stats, activeSkillsCount: 0, activeSkillNames: [] };
    expect(pluginStatusLine("agentSkills", true, empty)).toBe(
      "0 skills active \u00b7 design, research, writing",
    );
  });
});

// ---------------------------------------------------------------------------
// Skill catalog domains + per-skill toggles
// ---------------------------------------------------------------------------

describe("skill catalog", () => {
  it("groups Core, System, and Specialized domains", () => {
    expect(SKILL_CATALOG.map((s) => s.name)).toEqual([
      "design",
      "research",
      "writing",
      "terminal",
      "git",
      "database",
      "security",
      "performance",
      "i18n",
    ]);
    expect(SKILL_CATALOG.filter((s) => s.domain === "Core").map((s) => s.name)).toEqual([
      "design",
      "research",
      "writing",
    ]);
    expect(SKILL_CATALOG.filter((s) => s.domain === "System").map((s) => s.name)).toEqual([
      "terminal",
      "git",
    ]);
    expect(SKILL_CATALOG.filter((s) => s.domain === "Specialized").map((s) => s.name)).toEqual([
      "database",
      "security",
      "performance",
      "i18n",
    ]);
  });

  it("activates Core and System skills, leaves Specialized off by default", () => {
    for (const name of ["design", "research", "writing", "terminal", "git"]) {
      expect(defaultSkillState(name)).toBe(true);
    }
    for (const name of ["database", "security", "performance", "i18n"]) {
      expect(defaultSkillState(name)).toBe(false);
    }
  });

  it("resolves per-skill state with persisted overrides winning", () => {
    expect(skillEnabled(DEFAULT_PLUGINS, "design")).toBe(true);
    expect(skillEnabled(DEFAULT_PLUGINS, "database")).toBe(false);
    expect(skillEnabled({ ...DEFAULT_PLUGINS, skills: { database: true } }, "database")).toBe(true);
    expect(skillEnabled({ ...DEFAULT_PLUGINS, skills: { design: false } }, "design")).toBe(false);
  });

  it("lists catalog skills first, then extra installed skills sorted", () => {
    expect(skillDisplayList(["research"])).toEqual([
      "design",
      "research",
      "writing",
      "terminal",
      "git",
      "database",
      "security",
      "performance",
      "i18n",
    ]);
    expect(skillDisplayList(["zeta", "alpha"])).toEqual([
      "design",
      "research",
      "writing",
      "terminal",
      "git",
      "database",
      "security",
      "performance",
      "i18n",
      "alpha",
      "zeta",
    ]);
  });

  it("toggles individual skills into plugins.skills", () => {
    const on = toggleSkill(DEFAULT_PLUGINS, "database");
    expect(on.skills).toEqual({ database: true });
    expect(skillEnabled(on, "database")).toBe(true);
    const off = toggleSkill(on, "design");
    expect(off.skills).toEqual({ database: true, design: false });
    expect(activeSkillNamesFromState(off, ["design", "database"])).toEqual([
      "research",
      "writing",
      "terminal",
      "git",
      "database",
    ]);
  });

  it("round-trips per-skill state through the global config", () => {
    const home = tmp("skills-persist");
    saveGlobalPlugins(toggleSkill(DEFAULT_PLUGINS, "database"), home);
    const loaded = loadGlobalPlugins(home);
    expect(loaded.skills).toEqual({ database: true });
    expect(skillEnabled(loaded, "database")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PluginsTab rendering (fixed columns, wrapped descriptions, inspect list)
// ---------------------------------------------------------------------------

describe("PluginsTab", () => {
  it("renders fixed name columns, wrapped descriptions, and the inspect list", async () => {
    const ink = await import("ink");
    const React = (await import("react")).default;
    const { PluginsTab } = await import("../src/components/PluginsTab.js");
    const { DEFAULT_PLUGINS, DEFAULT_PLUGIN_STATS } = await import("../src/components/settings.js");
    const { toggleSkill } = await import("../src/components/plugins.js");
    const stats = {
      ...DEFAULT_PLUGIN_STATS,
      ponytailSavings: 1200,
      graphifyNodeCount: 42,
      activeSkillsCount: 5,
      activeSkillNames: ["design", "research", "writing", "terminal", "git"],
    };
    const closed = ink.renderToString(
      React.createElement(PluginsTab, {
        plugins: DEFAULT_PLUGINS,
        selectedIndex: 2,
        stats,
        activeSubView: "main",
        inspectIndex: 0,
      }),
    );
    expect(closed).toContain("Ponytail");
    expect(closed).toContain("Graphify");
    expect(closed).toContain("Agent Skills");
    expect(closed).toContain("Turns codebase into a knowledge graph");
    expect(closed).toContain("5 skills active");
    const open = ink.renderToString(
      React.createElement(PluginsTab, {
        plugins: toggleSkill(DEFAULT_PLUGINS, "database"),
        selectedIndex: 2,
        stats,
        activeSubView: "agentSkills",
        inspectIndex: 5,
      }),
    );
    for (const name of ["design", "terminal", "git", "database", "security"]) {
      expect(open).toContain(name);
    }
    expect(open).toContain("Specialized");
  });
});

// ---------------------------------------------------------------------------
// Ruflo modules + runtime
// ---------------------------------------------------------------------------

describe("Ruflo modules", () => {
  it("ships core, swarm, memory, and SONA (auto) with only SONA off by default", async () => {
    const mod = await import("../src/components/plugins.js");
    expect(mod.RUFLO_MODULES.map((m) => m.id)).toEqual([
      "ruflo-core",
      "ruflo-swarm",
      "ruflo-memory",
      "ruflo-auto",
    ]);
    expect(mod.RUFLO_MODULES[0].description).toBe(
      "Base swarm harness & agent event loop",
    );
    expect(mod.RUFLO_MODULES[1].description).toBe(
      "Queen/Worker coordinator (Parallel)",
    );
    expect(mod.RUFLO_MODULES[2].description).toBe(
      "Vector-backed cross-session RAG index",
    );
    expect(mod.RUFLO_MODULES[3].description).toBe(
      "Adaptive routing & cost optimizer",
    );
    expect(mod.defaultRufloModuleState("ruflo-core")).toBe(true);
    expect(mod.defaultRufloModuleState("ruflo-swarm")).toBe(true);
    expect(mod.defaultRufloModuleState("ruflo-memory")).toBe(true);
    expect(mod.defaultRufloModuleState("ruflo-auto")).toBe(false);
    expect(mod.rufloModuleEnabled(DEFAULT_PLUGINS, "ruflo-core")).toBe(true);
    expect(mod.rufloModuleEnabled(DEFAULT_PLUGINS, "ruflo-auto")).toBe(false);
    // Legacy alias still resolves to the canonical module.
    expect(mod.canonicalRufloModuleId("ruflo-autopilot")).toBe("ruflo-auto");
    expect(mod.rufloModuleEnabled(DEFAULT_PLUGINS, "ruflo-autopilot")).toBe(false);
  });

  it("toggles modules into plugins.rufloModules and lists actives", async () => {
    const mod = await import("../src/components/plugins.js");
    const on = mod.toggleRufloModule(DEFAULT_PLUGINS, "ruflo-auto");
    expect(on.rufloModules).toEqual({ "ruflo-auto": true });
    expect(mod.rufloModuleEnabled(on, "ruflo-auto")).toBe(true);
    expect(mod.activeRufloModules(on)).toEqual([
      "ruflo-core",
      "ruflo-swarm",
      "ruflo-memory",
      "ruflo-auto",
    ]);
    const off = mod.toggleRufloModule(on, "ruflo-core");
    expect(mod.activeRufloModules(off)).toEqual([
      "ruflo-swarm",
      "ruflo-memory",
      "ruflo-auto",
    ]);
  });

  it("reads the local harness runtime (0 workers on ruflo-core)", async () => {
    const mod = await import("../src/components/plugins.js");
    expect(mod.readRufloRuntime()).toEqual({ activeWorkers: 0, runtime: "ruflo-core" });
    expect(mod.readRufloRuntime({ activeWorkers: 3, runtime: "ruflo-swarm" })).toEqual({
      activeWorkers: 3,
      runtime: "ruflo-swarm",
    });
    const home = tmp("ruflo-persist");
    const mod2 = await import("../src/components/settings.js");
    saveGlobalPlugins(mod.toggleRufloModule(DEFAULT_PLUGINS, "ruflo-auto"), home);
    const loaded = loadGlobalPlugins(home);
    expect(loaded.rufloModules).toEqual({ "ruflo-auto": true });
    expect(mod2.normalizePlugins(loaded)).toEqual(loaded);
  });

  it("renders the Ruflo row and its module inspect list", async () => {
    const ink = await import("ink");
    const React = (await import("react")).default;
    const { PluginsTab } = await import("../src/components/PluginsTab.js");
    const { DEFAULT_PLUGINS, DEFAULT_PLUGIN_STATS } = await import("../src/components/settings.js");
    const closed = ink.renderToString(
      React.createElement(PluginsTab, {
        plugins: DEFAULT_PLUGINS,
        selectedIndex: 3,
        stats: DEFAULT_PLUGIN_STATS,
        activeSubView: "main",
        inspectIndex: 0,
      }),
    );
    expect(closed).toContain("Ruflo");
    expect(closed).toContain("Swarm Engine active");
    expect(closed).toContain("0 active workers");
    const open = ink.renderToString(
      React.createElement(PluginsTab, {
        plugins: DEFAULT_PLUGINS,
        selectedIndex: 3,
        stats: DEFAULT_PLUGIN_STATS,
        activeSubView: "ruflo",
        inspectIndex: 2,
      }),
    );
    for (const name of ["ruflo-core", "ruflo-swarm", "ruflo-memory", "ruflo-auto"]) {
      expect(open).toContain(name);
    }
    expect(open).toContain("Queen/Worker coordinator (Parallel)");
    expect(open).toContain("Adaptive routing & cost optimizer");
    // Sub-agent role checklist renders below the modules as horizontal badges.
    expect(open).toContain("SUB-AGENT ROLES");
    for (const role of ["architect", "coder", "reviewer", "tester"]) {
      expect(open).toContain(role);
    }
    expect(open).toContain("[✓] coder");
    expect(open).toContain("[ ] tester");
  });
});
