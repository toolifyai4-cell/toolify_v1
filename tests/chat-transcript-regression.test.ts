import { describe, it, expect } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import {
  ChatUI,
  BOTTOM_PANEL_HEIGHT,
  type ChatUIProps,
  type ChatMessage,
} from "../src/components/ChatUI.js";

/**
 * Regression tests for the "hidden transcript" bug:
 *
 * Completed messages used to render via Ink's <Static> ABOVE a fullscreen
 * dynamic frame (minHeight={rows}). The frame alone filled the viewport, so
 * <Static> output was always pushed into scrollback — invisible. On win32,
 * Ink clears the terminal (ESC[2J ESC[3J ESC[H — including the SCROLLBACK)
 * on every fullscreen frame, and ChatUI re-rendered every 500ms (blink
 * cursor), so anything the user scrolled up to read vanished again within
 * ~1 second.
 *
 * The fix renders the transcript INSIDE the dynamic frame as a bounded
 * window. These tests assert that:
 *   1. completed answers are part of every repaint (not a one-time flush);
 *   2. the newest answer stays visible while streaming;
 *   3. PgUp/PgDn in-app scrolling reveals older messages;
 *   4. the bottom panel stays pinned inside the viewport.
 */

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
    workspace: "C:\\tmp\\toolify-regression",
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

/** Strip ANSI escape sequences so assertions match plain text. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b[[0-9;?]*[A-Za-z]/g, "");
}

/** CSI sequences for PageUp / PageDown (as sent by real terminals). */
const PG_UP = "\x1b[5~";
const PG_DN = "\x1b[6~";



describe("Chat transcript stays visible (hidden-transcript regression)", () => {
  it("keeps completed answers repainted in every frame (no one-time scrollback flush)", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "what is the capital of France?" },
      { role: "assistant", content: "Paris is the capital of France." },
    ];
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps({ messages })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(200); // let the initial mount flush
      const settleIdx = writes.length;
      await sleep(1300); // >= 2 blink ticks (500ms each) trigger repaints

      const repaints = stripAnsi(writes.slice(settleIdx).join(""));
      // Frames written after the initial mount are blink-driven repaints of
      // the DYNAMIC frame. The answer must be inside it: with the old
      // <Static> design these repaints contained only input+status, and the
      // answer was written exactly once, above the viewport, then wiped.
      expect(repaints).toContain("Paris is the capital of France.");
      expect(repaints).toContain("what is the capital of France?");
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("keeps the newest prompt visible while a new response is streaming", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "", thinking: true },
    ];
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(
      React.createElement(ChatUI, baseProps({ messages, isRunning: true })),
      { stdout: stream, stdin, exitOnCtrlC: false, interactive: true },
    );
    try {
      await sleep(250);
      const frame = stripAnsi(writes.join(""));
      expect(frame).toContain("second question"); // the in-flight prompt
      expect(frame).toContain("first answer"); // prior turn still visible
      expect(frame).toContain("Thinking...");
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("reveals older messages with PgUp and returns with PgDn", async () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: "user", content: `question ${i}` });
      messages.push({ role: "assistant", content: `answer ${i}` });
    }
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps({ messages })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(200);

      // 20 messages overflow the 17-row window: the oldest pair is clipped.
      const initial = stripAnsi(writes.join(""));
      expect(initial).toContain("answer 9"); // newest visible
      expect(initial).not.toContain("question 0"); // oldest clipped

      // PgUp all the way back (clamped at messages.length - 1).
      stdin.push(PG_UP.repeat(8));
      await sleep(300);
      const scrolled = stripAnsi(writes.slice(-5).join(""));
      expect(scrolled).toContain("question 0");

      // PgDn returns to the newest messages.
      stdin.push(PG_DN.repeat(8));
      await sleep(300);
      const returned = stripAnsi(writes.slice(-3).join(""));
      expect(returned).toContain("answer 9");
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("pins the bottom panel and keeps the frame within the viewport", async () => {
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps()), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(200);
      const lines = stripAnsi(writes.join("")).split("\n");
      // The input row sits at or below rows - BOTTOM_PANEL_HEIGHT and the
      // frame is exactly terminal height (no scrollback reliance).
      const inputIndex = lines.findIndex((l) =>
        l.includes("Type a message or / for commands"),
      );
      expect(inputIndex).toBeGreaterThanOrEqual(24 - BOTTOM_PANEL_HEIGHT);
      expect(lines.length).toBeGreaterThanOrEqual(23);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
});

