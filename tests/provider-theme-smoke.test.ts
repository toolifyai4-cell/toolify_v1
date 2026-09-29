import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToString } from "ink";
import { Text } from "ink";

import { ThemeProvider, useTheme } from "../src/theme/ThemeContext.js";
import { getProviderTokens } from "../src/theme/provider-colors.js";
import { ansi } from "../src/theme/ansi.js";

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

function Probe(): React.ReactElement {
  const { tokens } = useTheme();
  return React.createElement(Text, null, ansi(tokens.primary) + "X" + "\x1b[39m");
}

describe("Provider Theme — live recolour on model switch", () => {
  it("recolours to blue when the active provider is gemini", () => {
    setPersistedTheme("provider");
    const out = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "gemini" },
        React.createElement(Probe),
      ),
    );
    expect(out).toContain("\x1b[34m"); // blue
  });

  it("recolours to orange when the active provider is anthropic", () => {
    setPersistedTheme("provider");
    const out = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "anthropic" },
        React.createElement(Probe),
      ),
    );
    expect(out).toContain("\x1b[38;5;208m"); // orange 256-color
  });

  it("recolours to green when the active provider is openai", () => {
    setPersistedTheme("provider");
    const out = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "openai" },
        React.createElement(Probe),
      ),
    );
    expect(out).toContain("\x1b[32m"); // green
  });

  it("recolours to magenta when the active provider is openrouter", () => {
    setPersistedTheme("provider");
    const out = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "openrouter" },
        React.createElement(Probe),
      ),
    );
    expect(out).toContain("\x1b[35m"); // magenta
  });

  it("falls back to cyan for an unknown provider", () => {
    setPersistedTheme("provider");
    const out = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "ollama" },
        React.createElement(Probe),
      ),
    );
    expect(out).toContain("\x1b[36m"); // cyan
  });

  it("does NOT recolour when a static theme is active", () => {
    setPersistedTheme("matrix");
    const out = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "anthropic" },
        React.createElement(Probe),
      ),
    );
    expect(out).not.toContain("\x1b[38;5;208m"); // orange must not appear
    expect(out).toContain("\x1b[32m"); // matrix green instead
  });

  it("recolours live when the provider prop changes", () => {
    setPersistedTheme("provider");
    const gemini = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "gemini" },
        React.createElement(Probe),
      ),
    );
    const anthropic = renderToString(
      React.createElement(
        ThemeProvider,
        { provider: "anthropic" },
        React.createElement(Probe),
      ),
    );
    expect(gemini).toContain("\x1b[34m");
    expect(anthropic).toContain("\x1b[38;5;208m");
  });

  it("exposes every provider token through getProviderTokens", () => {
    expect(getProviderTokens("gemini").primary).toBe("blue");
    expect(getProviderTokens("anthropic").primary).toBe("\x1b[38;5;208m");
    expect(getProviderTokens("openai").primary).toBe("green");
    expect(getProviderTokens("openrouter").primary).toBe("magenta");
    expect(getProviderTokens("omniroute").primary).toBe("cyan");
    expect(getProviderTokens("unorouter").primary).toBe("blue");
    expect(getProviderTokens(undefined).primary).toBe("cyan");
  });
});