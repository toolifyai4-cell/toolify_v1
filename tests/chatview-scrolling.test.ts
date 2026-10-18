import { describe, it, expect } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render, renderToString } from "ink";
import {
  ChatUI,
  estimateMessageLines,
  type ChatUIProps,
  type ChatMessage,
} from "../src/components/ChatUI.js";

/**
 * Tests for the windowed transcript rendering (completed + active messages
 * render INSIDE the fixed-height frame) and the estimateMessageLines
 * utility used to budget the window.
 */

// ── Helpers ──────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function makeStdout(rows: number, columns = 80) {
  const writes: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      writes.push(chunk.toString());
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stream, { isTTY: true, columns, rows });
  return { stream, writes };
}

function makeStdin() {
  const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  return stdin;
}

function baseProps(overrides: Partial<ChatUIProps> = {}): ChatUIProps {
  return {
    messages: [],
    status: { model: "gpt-4o", inputTokens: 0, outputTokens: 0, turnCount: 0 },
    mode: "act",
    autoApprove: "off",
    workspace: "C:\\tmp\\toolify-scroll",
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

/** Strip ANSI escape codes and return only writes from startIdx onward. */
function frameFrom(writes: string[], startIdx = 0): string {
  return writes
    .slice(startIdx)
    .join("")
    .replace(/\x1b[[0-9;?]*[A-Za-z]/g, "");
}

/**
 * Build N short user/assistant message pairs for scroll tests.
 */
function buildMessages(n: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    msgs.push({ role: "user", content: `question ${i}` });
    msgs.push({ role: "assistant", content: `answer ${i}` });
  }
  return msgs;
}

// ── estimateMessageLines unit tests ──────────────────────────────────────

describe("estimateMessageLines", () => {
  it("estimates minimum 3 lines for a short message (badge + content + padding)", () => {
    const msg: ChatMessage = { role: "user", content: "hi" };
    expect(estimateMessageLines(msg, 80)).toBeGreaterThanOrEqual(3);
  });

  it("counts wrapped lines for long content", () => {
    const longContent = "x".repeat(200);
    const msg: ChatMessage = { role: "assistant", content: longContent };
    const shortMsg: ChatMessage = { role: "assistant", content: "short" };
    expect(estimateMessageLines(msg, 80)).toBeGreaterThan(
      estimateMessageLines(shortMsg, 80),
    );
  });

  it("counts more lines for multi-line content than single-line", () => {
    const single: ChatMessage = { role: "user", content: "one line" };
    const multi: ChatMessage = { role: "user", content: "line1\nline2\nline3" };
    expect(estimateMessageLines(multi, 80)).toBeGreaterThan(
      estimateMessageLines(single, 80),
    );
  });

  it("adds lines for tool calls", () => {
    const plain: ChatMessage = { role: "assistant", content: "ok" };
    const withTools: ChatMessage = {
      role: "assistant",
      content: "ok",
      toolCalls: [
        { id: "c1", name: "write_file" as never, input: { path: "x.ts" } },
      ],
    };
    expect(estimateMessageLines(withTools, 80)).toBeGreaterThan(
      estimateMessageLines(plain, 80),
    );
  });

  it("adds lines for tool results", () => {
    const plain: ChatMessage = { role: "assistant", content: "ok" };
    const withResults: ChatMessage = {
      role: "assistant",
      content: "ok",
      toolResults: [{ callId: "c1", content: "result data" }],
    };
    expect(estimateMessageLines(withResults, 80)).toBeGreaterThan(
      estimateMessageLines(plain, 80),
    );
  });

  it("estimates fewer lines per message at wider terminals", () => {
    const msg: ChatMessage = { role: "user", content: "x".repeat(100) };
    const narrow = estimateMessageLines(msg, 20);
    const wide = estimateMessageLines(msg, 200);
    expect(narrow).toBeGreaterThan(wide);
  });
});

// --- ChatUI windowed transcript rendering ---

describe("ChatUI windowed transcript", () => {
  it("renders all completed messages when they fit the window", () => {
    const messages = buildMessages(2);
    const out = renderToString(
      React.createElement(ChatUI, baseProps({ messages })),
      { columns: 80 },
    );
    for (const m of messages) {
      expect(out).toContain(m.content);
    }
  });

  it("clips older messages but keeps the newest visible", () => {
    const messages = buildMessages(8);
    const out = renderToString(
      React.createElement(ChatUI, baseProps({ messages })),
      { columns: 80 },
    );
    expect(out).toContain("question 7");
    expect(out).toContain("answer 7");
    expect(out).not.toContain("question 0");
  });

  it("renders the active streaming message live when isRunning", () => {
    const messages = buildMessages(3);
    const out = renderToString(
      React.createElement(ChatUI, baseProps({ messages, isRunning: true })),
      { columns: 80 },
    );
    expect(out).toContain("answer 2");
    expect(out).toContain("question 2");
        expect(out).toContain("[NEXIPI-CORE]");
  });

  it("appends new completed messages to the window on rerender", async () => {
    const messages = buildMessages(5);
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps({ messages })), {
      stdout: stream, stdin, exitOnCtrlC: false, interactive: true,
    });
    await sleep(150);

    const prevWrites = writes.length;
    const updated = [
      ...messages,
      { role: "assistant" as const, content: "streamed response" },
    ];
    instance.rerender(React.createElement(ChatUI, baseProps({ messages: updated })));
    await sleep(150);
    await instance.waitUntilRenderFlush();
    await sleep(50);

    const frame = frameFrom(writes, prevWrites);
    expect(frame).toContain("streamed response");

    instance.unmount();
    await sleep(50);
  });

  it("keeps input bar and status bar pinned at the bottom of the terminal", async () => {
    const messages = buildMessages(15);
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(
      React.createElement(ChatUI, baseProps({ messages, isRunning: true })),
      { stdout: stream, stdin, exitOnCtrlC: false, interactive: true },
    );
    await sleep(150);

    const frame = frameFrom(writes);
    const lines = frame.split("\n").map((line) => line.trimEnd());

    const inputIndex = lines.findIndex((l) =>
      l.includes("Type a message or / for commands"),
    );
    const statusIndex = lines.findIndex((l) => l.includes("Auto-approve off"));

    expect(inputIndex).toBeGreaterThanOrEqual(0);
    expect(inputIndex).toBeGreaterThanOrEqual(24 - 6);
    expect(statusIndex).toBeGreaterThan(inputIndex);
    expect(statusIndex).toBeGreaterThanOrEqual(24 - 3);
    expect(lines.length).toBeGreaterThanOrEqual(24 - 1);

    instance.unmount();
    await sleep(50);
  });

  it("does NOT render any scroll-indicator text", () => {
    const messages = buildMessages(10);
    const out = renderToString(
      React.createElement(ChatUI, baseProps({ messages })),
      { columns: 80 },
    );
    expect(out).not.toContain("scrolled up");
    expect(out).not.toContain("SCROLLED UP");
    expect(out).not.toContain("Press PgDn");
    expect(out).not.toContain("Press");
  });

  it("keeps newest messages visible in large conversations; PgUp reaches older ones", async () => {
    const messages = buildMessages(20); // 40 messages - far beyond the window
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps({ messages })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    await sleep(150);

    const initial = frameFrom(writes);
    expect(initial).toContain("answer 19"); // newest always visible
    expect(initial).not.toContain("question 0"); // oldest clipped by the window

    // PgUp all the way back (scroll is clamped at messages.length - 1).
    stdin.push("\x1b[5~".repeat(13));
    await sleep(300);
    const scrolled = frameFrom(writes.slice(-6));
    expect(scrolled).toContain("question 0");

    instance.unmount();
    await sleep(50);
  });

    it("reveals older messages with PgUp and returns to the newest with PgDn", async () => {
    const messages = buildMessages(20); // 40 messages - far beyond the window
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(
      React.createElement(ChatUI, baseProps({ messages })),
      { stdout: stream, stdin, exitOnCtrlC: false, interactive: true },
    );
    await sleep(150);

    const initial = frameFrom(writes);
    expect(initial).toContain("answer 19"); // newest visible at bottom
    expect(initial).not.toContain("question 0"); // oldest clipped by the window
    // PgUp scrolls back by SCROLL_STEP (3) per press, clamped at length - 1.
    stdin.push("\x1b[5~".repeat(13));
    await sleep(300);
    const scrolled = frameFrom(writes.slice(-6));
    expect(scrolled).toContain("question 0"); // oldest now reachable
    // PgDn returns toward the newest.
    stdin.push("\x1b[6~".repeat(13));
    await sleep(300);
    const returned = frameFrom(writes.slice(-3));
    expect(returned).toContain("answer 19"); // newest restored
    instance.unmount();
    await sleep(50);
  });

  it("does not scroll the transcript while the slash command menu is open", async () => {
    // Guards: ↑/↓ must navigate the command menu, not the transcript, while
    // the menu is open. Arrow keys are dedicated to cursor movement / history
    // / menu navigation — NOT transcript scrolling (PgUp/PgDn scrolls).
    const messages = buildMessages(20);
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(
      React.createElement(ChatUI, baseProps({ messages })),
      { stdout: stream, stdin, exitOnCtrlC: false, interactive: true },
    );
    await sleep(150);
    // Open the slash menu — the transcript remains rendered above it.
    stdin.push("/");
    await sleep(250);

    const withMenu = frameFrom(writes);
    expect(withMenu).toContain("▼ 2 more"); // menu open (8 cmds vs page 6)
    expect(withMenu).toContain("answer 19"); // transcript still painted
    expect(withMenu).not.toContain("question 0"); // oldest still clipped

    // Up arrow navigates the menu, not the transcript.
    stdin.push("\x1b[A");
    await sleep(250);

    const afterUp = frameFrom(writes.slice(-4));
    expect(afterUp).toContain("▼ 2 more"); // menu still open
    expect(afterUp).toContain("answer 19"); // newest still visible (no scroll)
    expect(afterUp).not.toContain("question 0"); // did NOT scroll to reveal it
    instance.unmount();
    await sleep(50);
  });

});
