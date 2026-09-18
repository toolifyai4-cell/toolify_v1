function renderConfigModal(
  initialStep: number,
  needsBaseUrl = false,
  initialStatus: "idle" | "verifying" | "ok" | "error" = "idle",
): string {
  return renderToString(
    React.createElement(ProviderConfigModal, {
      providerId: "openai" as const,
      providerName: "OpenAI",
      defaultModel: "gpt-4o",
      needsBaseUrl,
      guidanceText: "Enter your openai API key to continue.",
      obtainUrl: "https://platform.openai.com/api-keys",
      workspace: "C:\\tmp\\toolify-fresh",
      initialStep,
      initialStatus,
      onConfirm: () => {},
      onCancel: () => {},
    }),
    { columns: 80 },
  );
}

describe("ProviderConfigModal (regression: escaped unicode + input handling)", () => {
  it("renders no literal \\u2588 / \\u00b7 escape text anywhere", () => {
    for (const step of [0, 1, 2]) {
      const out = renderConfigModal(step, true);
      expect(out).not.toContain("\\u2588");
      expect(out).not.toContain("\\u00b7");
      expect(out).not.toContain("\\u2500");
      expect(out).not.toContain("\\u2713");
      expect(out).not.toContain("\\u2717");
    }
  });

  it("renders real rendered glyphs for the separators and divider", () => {
    const out = renderConfigModal(0);
    expect(out).toContain("·"); // real middle dot between step labels
    expect(out).toContain("─"); // real box-drawing divider
  });

  it("api-key step shows the focused native TextInput with placeholder", () => {
    const out = renderConfigModal(1);
    // Native component renders its own placeholder inside a bordered field.
    expect(out).toContain("Paste your key here...");
    expect(out).toContain("API Key");
    // The hand-rolled blink cursor is gone: no raw block character and no
    // literal escape text may appear (native inverse-video cursor instead).
    expect(out).not.toContain("█");
    expect(out).not.toContain("\\u2588");
    expect(out).not.toContain("undefined");
  });

  it("shows the Base URL field for local gateways and hides it for cloud keys", () => {
    expect(renderConfigModal(1, true)).toContain("Base URL (optional)");
    expect(renderConfigModal(1, false)).not.toContain("Base URL (optional)");
  });

  it("verify step renders the spec'd status panes with real glyphs", () => {
    const ok = renderConfigModal(2, false, "ok");
    expect(ok).toContain("[✓] Configuration Verified & Successful!");
    expect(ok).toContain("Key saved to ~/.toolify/config.json");
    expect(ok).toContain("Press Enter or Esc to return to Settings.");
    expect(ok).toContain(String.fromCodePoint(0x2713));
    expect(ok).not.toContain("\\u2713");
    const err = renderConfigModal(2, false, "error");
    expect(err).toContain("[✗] Verification Failed: Invalid API Key or Unauthorized");
    expect(err).toContain(String.fromCodePoint(0x2717));
    expect(err).not.toContain("\\u2717");
    const verifying = renderConfigModal(2, false, "verifying");
    expect(verifying).toContain("Verifying API key with provider endpoint...");
  });
});

describe("ProviderConfigModal live verification flow", () => {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  function fakeStdout(writes: string[]): NodeJS.WriteStream {
    const stream = new Writable({
      write(chunk, _enc, cb) {
        writes.push(chunk.toString());
        cb();
      },
    }) as unknown as NodeJS.WriteStream;
    Object.assign(stream, { isTTY: true, columns: 80, rows: 24 });
    return stream;
  }

  function fakeStdin(): NodeJS.ReadStream {
    const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
    Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
    return stdin;
  }

  function modalProps(overrides: Record<string, unknown> = {}) {
    return {
      providerId: "openai" as const,
      providerName: "OpenAI",
      defaultModel: "gpt-4o",
      needsBaseUrl: false,
      guidanceText: "Enter your openai API key to continue.",
      obtainUrl: "https://platform.openai.com/api-keys",
      workspace: "C:\\tmp\\toolify-fresh",
      initialStep: 1,
      onConfirm: () => {},
      onCancel: () => {},
      ...overrides,
    };
  }

  it("pastes a key, verifies on Enter, persists on 2xx, closes on Esc", async () => {
    const writes: string[] = [];
    const confirmCalls: Array<{ provider: string; key: string; baseUrl: string }> = [];
    let cancelled = 0;
    const stdin = fakeStdin();
    const instance = render(
      React.createElement(
        ProviderConfigModal,
        modalProps({
          verify: async () => ({ ok: true, detail: "" }),
          onConfirm: (provider: string, key: string, baseUrl: string) => {
            confirmCalls.push({ provider, key, baseUrl });
          },
          onCancel: () => {
            cancelled += 1;
          },
        }),
      ),
      { stdout: fakeStdout(writes), stdin, exitOnCtrlC: false, interactive: true },
    );
        try {
      await sleep(120);
      // A terminal paste buffer arrives as ONE multi-character chunk.
      stdin.push("sk-live-pasted-key");
      await sleep(80);
      stdin.push("\r"); // Enter on the "Enter Key" step -> live verification
      await sleep(200);
      // Flush any pending React state updates from the async verify callback.
      await instance.waitUntilRenderFlush();
      expect(confirmCalls).toEqual([
        { provider: "openai", key: "sk-live-pasted-key", baseUrl: "" },
      ]);
      const frame = writes.join("");
      expect(frame).toContain("Configuration Verified & Successful!");
      expect(frame).toContain("Key saved to ~/.toolify/config.json");
      expect(frame).toContain("Press Enter or Esc to return to Settings.");
      stdin.push("\x1b"); // Esc on the success pane returns to Settings
      await sleep(120);
      await instance.waitUntilRenderFlush();
      expect(cancelled).toBe(1);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("does NOT persist on 401 and returns to the focused input for editing", async () => {
    const writes: string[] = [];
    const confirmCalls: unknown[] = [];
    let verifyCalls = 0;
    const stdin = fakeStdin();
    const instance = render(
      React.createElement(
        ProviderConfigModal,
        modalProps({
          verify: async () => {
            verifyCalls += 1;
            return { ok: false, detail: "Incorrect API key provided (HTTP 401)" };
          },
          onConfirm: () => {
            confirmCalls.push(true);
          },
        }),
      ),
      { stdout: fakeStdout(writes), stdin, exitOnCtrlC: false, interactive: true },
    );
    try {
      await sleep(120);
      stdin.push("bad-key");
      await sleep(80);
      stdin.push("\r");
      await sleep(200);
      expect(confirmCalls).toHaveLength(0); // invalid key was never saved
      const frame = writes.join("");
      expect(frame).toContain("[✗] Verification Failed: Invalid API Key or Unauthorized");
      expect(frame).toContain("Incorrect API key provided (HTTP 401)");
      expect(frame).toContain("Edit or re-paste your key, then press Enter to verify again.");
      // The input field is back with the draft key preserved (masked bullets).
      expect(frame).toContain("•••");
      // Pressing Enter again re-runs verification against the edited key.
      stdin.push("\r");
      await sleep(200);
      expect(verifyCalls).toBe(2);
      expect(confirmCalls).toHaveLength(0);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
});

function wizardProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    needsAuth: false,
    existingConfig: null,
    callbacks: {
      runLogin: () => Promise.resolve({ name: "t", id: "1" }),
      saveConfig: () => Promise.resolve(),
    },
    onFinish: () => {},
    ...overrides,
  };
}

describe("OnboardingWizard apikey step (regression: paste + focus)", () => {
  it("renders the API key field with a focused native TextInput and real separator", () => {
    // Default flow for non-auth users lands directly on the apikey step.
    const out = renderToString(
      React.createElement(OnboardingWizard, wizardProps()),
      { columns: 80 },
    );
    expect(out).toContain("Paste your API key here...");
    expect(out).toContain("Key:");
    expect(out).not.toContain("\\u00b7"); // footer separator renders for real
    expect(out).toContain("·");
    expect(out).not.toContain("undefined");
  });
});

import { describe, it, expect } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render, renderToString } from "ink";
import {
  ChatUI,
  BALL_ACTIVE,
  BALL_IDLE,
  type ChatUIProps,
  type ChatMessage,
} from "../src/components/ChatUI.js";
import { MenuScreen } from "../src/components/MenuScreen.js";
import { ProviderConfigModal } from "../src/components/ProviderConfigModal.js";
import { OnboardingWizard } from "../src/components/OnboardingWizard.js";

/**
 * Render smoke tests.
 *
 * These exist because a malformed JSX comment in ChatUI.tsx
 * (`{/* Hint line *` without the closing `}`) made esbuild fail to transform the
 * file, which crashed every CLI entry point on startup:
 *   "ChatUI.tsx:176:10: ERROR: Unterminated regular expression"
 *
 * `renderToString` renders synchronously with no terminal bindings, so it is
 * safe in CI (terminal hooks become no-ops instead of calling setRawMode).
 */

function chatProps(overrides: Partial<ChatUIProps> = {}): ChatUIProps {
  return {
    messages: [],
    status: {
      model: "gpt-4o",
      inputTokens: 120,
      outputTokens: 30,
      turnCount: 1,
    },
    mode: "act",
    autoApprove: "off",
    workspace: "C:\\tmp\\toolify-fresh",
    isRunning: false,
    onSubmit: () => {},
    onModeToggle: () => {},
    onAutoApproveToggle: () => {},
    onClear: () => {},
    onExit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

function renderChat(props: Partial<ChatUIProps> = {}, columns = 80): string {
  return renderToString(React.createElement(ChatUI, chatProps(props)), { columns });
}

describe("ChatUI renders (regression: unterminated JSX comment)", () => {
  it("renders the idle landing state, input bar and status bar", () => {
    const out = renderChat();
    expect(out).toContain("What can I do for you?");
    expect(out).toContain("Type a message or / for commands...");
    expect(out).toContain("Model: ");
    expect(out).toContain("gpt-4o");
    expect(out).toContain("150");
    expect(out).not.toContain("128000");
    expect(out).toContain("C:\\tmp\\toolify-fresh");
  });

  it("renders the mode indicator with the active mode highlighted", () => {
    const act = renderChat(); // default mode is "act", displayed as "Build"
    expect(act).toContain("Plan: [OFF]");
    expect(act).toContain("| Build: [ON]");
    expect(act).toContain("(Tab)");

    const plan = renderChat({ mode: "plan" });
    expect(plan).toContain("Plan: [ON]");
    expect(plan).toContain("| Build: [OFF]");
  });

  it("uses real ball glyphs, not escaped text (regression guard)", () => {
    // A doubled backslash in the source would render the literal text "\u25cf"
    // instead of a circle, so assert on the actual code points.
    expect(BALL_ACTIVE).toBe(String.fromCodePoint(0x25cf));
    expect(BALL_IDLE).toBe(String.fromCodePoint(0x25cb));
    expect(BALL_ACTIVE).toHaveLength(1);
    expect(BALL_IDLE).toHaveLength(1);
  });

  it("no longer renders the old bracketed mode labels", () => {
    for (const mode of ["act", "plan"] as const) {
      const out = renderChat({ mode });
      expect(out).not.toContain("[PLAN]");
      expect(out).not.toContain("[ACT]");
      expect(out).not.toContain("[BUILD]");
    }
  });

  it("renders the auto-approve indicator variants", () => {
    const off = renderChat();
    expect(off).toContain("Auto-approve off");
    expect(off).toContain("(Shift+Tab)");
    expect(renderChat({ autoApprove: "writes" })).toContain("Auto-approve writes");
    expect(renderChat({ autoApprove: "all" })).toContain("Auto-approve ALL");
  });

  it("renders user, assistant, tool call and tool result content", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "write hello.ts" },
      {
        role: "assistant",
        content: "Done!\nSecond line",
        toolCalls: [{ id: "c1", name: "write_file", input: { path: "hello.ts" } }],
        toolResults: [{ callId: "c1", content: "Wrote 12 bytes to hello.ts" }],
      },
    ];
    const out = renderChat({ messages });
    expect(out).toContain("[YOU]");
    expect(out).toContain("write hello.ts");
    expect(out).toContain("[AGENT]");
    expect(out).toContain("Done!");
    expect(out).toContain("Second line");
    expect(out).toContain("[write_file]");
    expect(out).toContain('{"path":"hello.ts"}');
    expect(out).toContain("[result]");
    expect(out).toContain("Wrote 12 bytes to hello.ts");
    // The landing prompt is only shown when the transcript is empty and idle.
    expect(out).not.toContain("What can I do for you?");
  });

  it("flags failed tool results as errors", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "trying",
        toolResults: [{ callId: "c1", content: "boom", isError: true }],
      },
    ];
    const out = renderChat({ messages });
    expect(out).toContain("[error]");
    expect(out).toContain("boom");
  });

  it("hides the landing prompt while running and shows the busy indicator", () => {
    const running = renderChat({ isRunning: true });
    expect(running).not.toContain("What can I do for you?");

    const idle = renderChat({ isRunning: false });
    expect(idle).toContain("What can I do for you?");
  });

  it("renders a message history while running", () => {
    const out = renderChat({
      isRunning: true,
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "working" },
      ],
    });
    expect(out).toContain("working");
    expect(out).not.toContain("What can I do for you?");
  });
});

describe("MenuScreen renders", () => {
  const props = {
    userName: "anuma",
    user: { provider: "google", name: "anuma", id: "1" },
    config: { provider: "openai", model: "gpt-4o" },
    usage: { inputTokens: 1500, outputTokens: 400, costUsd: 0.02 },
    history: [{ role: "user" as const, preview: "hello world", ts: Date.now() }],
    onEnter: () => {},
    onEsc: () => {},
  };

  it("renders the home menu with all sections", () => {
    const out = renderToString(
      React.createElement(MenuScreen, props as never),
      { columns: 100 },
    );
    expect(out).toContain("Settings");
    expect(out).toContain("Welcome back,");
    expect(out).toContain("anuma");
    expect(out).toContain("Providers");
    expect(out).toContain("History");
    expect(out).toContain("Models");
    expect(out).toContain("Usage");
    expect(out).toContain("Exit");
    expect(out).toContain("navigate");
  });
});

/**
 * Layout regression: the input bar and status bar must be pinned to the BOTTOM.
 *
 * Ink only ever calls `rootNode.yogaNode.setWidth(...)` when computing layout
 * (ink.js `calculateLayout`), never `setHeight`. A `height="100%"` root
 * therefore resolves to nothing and the whole UI collapses to the top of the
 * terminal. ChatUI reads the real row count via `useWindowSize()` instead.
 */
describe("ChatUI fills the terminal height", () => {
  const ROWS = 24;

  function fakeStdout(rows: number) {
    const writes: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        writes.push(chunk.toString());
        cb();
      },
    }) as unknown as NodeJS.WriteStream;
    Object.assign(stream, { isTTY: true, columns: 80, rows });
    return { stream, writes };
  }

  function fakeStdin() {
    const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
    Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
    return stdin;
  }

  it("paints the input bar and status bar in the last rows of the terminal", async () => {
    const { stream, writes } = fakeStdout(ROWS);
    const instance = render(React.createElement(ChatUI, chatProps()), {
      stdout: stream,
      stdin: fakeStdin(),
      exitOnCtrlC: false,
      interactive: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    instance.unmount();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const frame = writes.join("").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const lines = frame.split("\n").map((line) => line.trimEnd());

    const promptIndex = lines.findIndex((l) => l.includes("What can I do for you?"));
    const inputIndex = lines.findIndex((l) => l.includes("Type a message or / for commands"));
    const statusIndex = lines.findIndex((l) => l.includes("Auto-approve off"));

    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(inputIndex).toBeGreaterThan(promptIndex); // input sits BELOW the transcript
    expect(statusIndex).toBeGreaterThan(inputIndex); // status sits below the input
    // With a collapsed (percentage) height this would be ~10, not >= ROWS - 6.
    expect(inputIndex).toBeGreaterThanOrEqual(ROWS - 6);
    expect(lines.length).toBeGreaterThanOrEqual(ROWS - 1);
  });
});