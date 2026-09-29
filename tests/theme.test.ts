import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToString, Text } from "ink";

import { THEMES, getThemeById, getThemeIds } from "../src/theme/themes.js";
import { ansi } from "../src/theme/ansi.js";
import {
  SETTINGS_THEMES,
  THEME_LABELS,
  defaultSettingsTheme,
} from "../src/components/settings.js";
import { ThemeModal } from "../src/components/ThemeModal.js";
import { ThemeProvider, useTheme } from "../src/theme/ThemeContext.js";
import { ModelsTab } from "../src/components/ModelsTab.js";
import type { ModelDescriptor } from "../src/models/model-registry.js";

/**
 * Hermetic fixture: redirect `os.homedir()` (via HOME/USERPROFILE) to a temp
 * dir and write a real `.toolify/config.json` so `readConfigSync` returns the
 * desired persisted theme. We deliberately avoid `vi.mock("../src/utils/config")`
 * because Bun's test runner shares the module registry across files — a module
 * mock leaks into every other test file and breaks credential resolution.
 */
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
let fixtureHome: string | null = null;
let configPath: string | null = null;

function setPersistedTheme(theme: string | undefined): void {
  if (!fixtureHome) {
    fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "toolify-theme-"));
    process.env.HOME = fixtureHome;
    process.env.USERPROFILE = fixtureHome;
    const dir = path.join(fixtureHome, ".toolify");
    fs.mkdirSync(dir, { recursive: true });
    configPath = path.join(dir, "config.json");
  }
  const cfg: Record<string, unknown> = { apiKeys: {}, baseUrls: {} };
  if (theme) cfg.theme = theme;
  fs.writeFileSync(configPath!, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

afterAll(() => {
  if (fixtureHome) {
    try {
      fs.rmSync(fixtureHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    fixtureHome = null;
    configPath = null;
  }
});

/** Renders the active theme id + two tokens so context propagation is visible. */
function TokenProbe(): React.ReactElement {
  const { theme, tokens } = useTheme();
  return React.createElement(Text, null, `${theme.id}|${tokens.border}|${tokens.primary}`);
}

describe("theme presets", () => {
  it("ships the four documented presets in display order", () => {
    expect(getThemeIds()).toEqual(["toolify-dark", "monochrome", "matrix", "dracula"]);
  });

  it("defines every color token on every preset", () => {
    const required = [
      "primary", "secondary", "background", "surface", "border",
      "text", "textMuted", "textInverted", "accent",
      "success", "warning", "error", "info",
    ];
    for (const theme of THEMES) {
      for (const token of required) {
        expect(
          typeof (theme.tokens as unknown as Record<string, unknown>)[token],
          `${theme.id}.${token}`,
        ).toBe("string");
      }
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.isDark).toBe(true);
    }
  });

  it("falls back to Toolify Dark for an unknown theme id", () => {
    expect(getThemeById("does-not-exist").id).toBe("toolify-dark");
    expect(getThemeById("dracula").id).toBe("dracula");
  });

  it("maps every theme id to a human-readable label", () => {
    for (const id of SETTINGS_THEMES) {
      expect(THEME_LABELS[id], `label for ${id}`).toBeTruthy();
    }
    expect(THEME_LABELS["toolify-dark"]).toBe("Toolify Dark");
  });

  it("normalizes persisted theme values, defaulting to toolify-dark", () => {
    expect(defaultSettingsTheme("matrix")).toBe("matrix");
    expect(defaultSettingsTheme("Light")).toBe("toolify-dark");
    expect(defaultSettingsTheme(undefined)).toBe("toolify-dark");
  });

  it("converts token color names into ANSI escapes", () => {
    expect(ansi("cyan")).toBe("\x1b[36m");
    expect(ansi("greenBright")).toBe("\x1b[92m");
    expect(ansi("not-a-color")).toBe("");
  });
});

describe("ThemeModal", () => {
  it("renders nothing while closed", () => {
    const out = renderToString(
      React.createElement(ThemeModal, { isOpen: false, onClose: () => {} }),
      { columns: 80 },
    );
    expect(out).toBe("");
  });

  it("lists every theme and marks the active one with ● (current)", () => {
    const out = renderToString(
      React.createElement(ThemeModal, { isOpen: true, onClose: () => {} }),
      { columns: 80 },
    );
    for (const label of Object.values(THEME_LABELS)) {
      expect(out).toContain(label);
    }
    // No provider mounted -> fallback context -> Toolify Dark is current.
    expect(out).toContain("Toolify Dark ● (current)");
    // Only one row may carry the current badge.
    expect(out.match(/● \(current\)/g)?.length).toBe(1);
    expect(out).toContain("Select Theme");
  });
});

describe("ThemeProvider", () => {
  it("reads the persisted theme id and exposes its tokens to consumers", () => {
        setPersistedTheme("dracula");
    const out = renderToString(
      React.createElement(ThemeProvider, {
        children: React.createElement(TokenProbe),
      }),
      { columns: 80 },
    );
    expect(out).toContain("dracula|magenta|magenta");
  });

  it("reacts to a different persisted theme (matrix)", () => {
        setPersistedTheme("matrix");
    const out = renderToString(
      React.createElement(ThemeProvider, {
        children: React.createElement(TokenProbe),
      }),
      { columns: 80 },
    );
    expect(out).toContain("matrix|green|green");
  });

  it("marks the provider's theme as current inside ThemeModal", () => {
        setPersistedTheme("monochrome");
    const out = renderToString(
      React.createElement(ThemeProvider, {
        children: React.createElement(ThemeModal, { isOpen: true, onClose: () => {} }),
      }),
      { columns: 80 },
    );
    expect(out).toContain("Monochrome ● (current)");
    expect(out.match(/● \(current\)/g)?.length).toBe(1);
  });

  it("persists the newly selected theme id via writeConfig", async () => {
        setPersistedTheme("toolify-dark");

    let captured: ((id: string) => Promise<void>) | null = null;
    function Capture(): React.ReactElement {
      const { setTheme } = useTheme();
      captured = setTheme;
      return React.createElement(Text, null, "ok");
    }

    renderToString(
      React.createElement(ThemeProvider, { children: React.createElement(Capture) }),
      { columns: 80 },
    );

    expect(captured).not.toBeNull();
    await captured!("matrix");

    const onDisk = JSON.parse(fs.readFileSync(configPath!, "utf8"));
    expect(onDisk.theme).toBe("matrix");
  });
});

describe("ModelsTab input isolation (no double capture / no double header)", () => {
  const models: readonly ModelDescriptor[] = [
    {
      id: "alpha",
      displayName: "Alpha",
      providerId: "test",
      providerName: "Test Provider",
      contextLimit: "128K",
      isFree: false,
    },
    {
      id: "beta",
      displayName: "Beta",
      providerId: "test",
      providerName: "Test Provider",
      contextLimit: "256K",
      isFree: false,
    },
  ];

  function shot(): string {
    return renderToString(
      React.createElement(ModelsTab, {
        models,
        activeModel: "alpha",
        activeProviderId: "test",
        isActive: true,
        onCommit: () => {},
        onClose: () => {},
      }),
      { columns: 90 },
    );
  }

  it("renders a single provider header, not a doubled one", () => {
    const out = shot();
    const headerHits = out.split("Provider:").length - 1;
    // One header line + one status line per live render; never grows.
    expect(headerHits).toBeLessThanOrEqual(2);
    expect(out).toContain("Provider: Test Provider");
  });

  it("renders a single search field for the single TextInput", () => {
    const out = shot();
    // The placeholder belongs to the single <TextInput>; the footer repeats
    // the word "search" inside its navigation hint, so count the placeholder.
    const placeholders = out.split("Type to search models...").length - 1;
    expect(placeholders).toBeLessThanOrEqual(1);
  });
});