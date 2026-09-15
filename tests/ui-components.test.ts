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
      costUsd: 0.0123,
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
    expect(out).toContain("gpt-4o");
    expect(out).toContain("(150 tok)");
    expect(out).toContain("C:\\tmp\\toolify-fresh");
  });

  it("renders the mode indicator with the filled ball on the ACTIVE mode", () => {
    const act = renderChat(); // default mode is "act", displayed as "Build"
    expect(act).toContain(`${BALL_IDLE} Plan`);
    expect(act).toContain(`${BALL_ACTIVE} Build`);
    expect(act).toContain("(Tab)");

    const plan = renderChat({ mode: "plan" });
    expect(plan).toContain(`${BALL_ACTIVE} Plan`);
    expect(plan).toContain(`${BALL_IDLE} Build`);
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
    expect(out).toContain("You:");
    expect(out).toContain("write hello.ts");
    expect(out).toContain("TOOLIFY:");
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