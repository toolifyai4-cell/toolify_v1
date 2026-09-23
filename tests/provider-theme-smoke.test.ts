import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "ink";
import { Text } from "ink";

import { ThemeProvider, useTheme } from "../src/theme/ThemeContext.js";
import { getProviderTokens } from "../src/theme/provider-colors.js";
import { ansi } from "../src/theme/ansi.js";

const store = vi.hoisted(() => ({
  theme: "provider" as string,
}));

vi.mock("../src/utils/config.js", () => ({
  readConfigSync: () => ({ apiKeys: {}, baseUrls: {}, theme: store.theme }),
  writeConfig: async () => {},
}));

function Probe(): React.ReactElement {
  const { tokens } = useTheme();
  return React.createElement(Text, null, ansi(tokens.primary) + "X" + "\x1b[39m");
}

describe("Provider Theme — live recolour on model switch", () => {
  it("recolours to blue when the active provider is gemini", () => {
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
    store.theme = "matrix";
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
    // Render once with gemini, then re-render with anthropic — the tokens
    // must follow the prop change (this is what makes /models switching live).
    store.theme = "provider";
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