import { describe, it, expect } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import {
  ChatUI,
  BOTTOM_PANEL_HEIGHT,
  type ChatUIProps,
} from "../src/components/ChatUI.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeStdout(rows = 24, columns = 80) {
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
    workspace: "C:\\TOOLIFY_V1",
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

const stripAnsi = (s: string): string => s.replace(/\x1b[[0-9;?]*[A-Za-z]/g, "");
const countOccurrences = (s: string, sub: string): number => s.split(sub).length - 1;

/**
 * Latest complete frame, as plain text. On win32 every frame is wrapped in
 * BSU/ESU sync markers, so split on the BSU marker BEFORE stripping ANSI.
 */
function latestFrame(writes: string[]): string {
  const raw = writes.join("");
  const segments = raw.split("\x1b[?2026h");
  return stripAnsi(segments[segments.length - 1] ?? "");
}

/** Row of the input box (contains the "You" badge; the placeholder is
 *  replaced by the typed text, e.g. "You /", while typing). */
function inputRow(lines: string[]): number {
  return lines.findIndex((l) => l.includes("You"));
}

/**
 * Regression tests for the slash-menu corruption: the menu used to overflow
 * the fixed-height frame, Yoga shrank the bottom panel (all Boxes default to
 * flexShrink: 1), and menu rows painted at overlapping positions — missing
 * commands, "Change color themeovider"-style overlap garbage, and fragmented
 * highlight blocks. The fix reserves the menu height from the transcript
 * budget and pins every box with flexShrink={0}.
 */
describe("slash menu fits the frame without overlap", () => {
  it("renders all 6 window rows + footer exactly once when / is typed", async () => {
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
      stdin.push("/");
      await sleep(250);
      const settleIdx = writes.length;
      await sleep(700); // >= 1 blink tick -> a full frame after the settle point
      const frame = latestFrame(writes.slice(settleIdx));

      // The command list now lives inside the centered SlashModal (double-bordered).
      // Command names are present; the list is a single contiguous copy.
      for (const name of ["/settings", "/model", "/theme", "/account", "/history", "/help"]) {
        expect(countOccurrences(frame, name)).toBe(1);
      }
      // Double-border separator lines distinguish consecutive matching commands
      // so each description appears exactly once between the two frame edges.
      const descs = [
        "Modify agent configuration",
        "Switch model or provider",
        "Change color theme",
        "View Toolify account",
        "Recent conversation turns",
        "Show available commands",
      ];
      for (const d of descs) {
        if (countOccurrences(frame, d) !== 1) {
          console.error('Frame:', JSON.stringify(frame));
          console.error('Looking for:', d);
          console.error('Count:', countOccurrences(frame, d));
        }
        expect(countOccurrences(frame, d)).toBe(1);
      }
      expect(frame).not.toContain("themeovider"); // overlap garbage
      expect(frame).toContain("You /"); // input box shows the typed slash
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("moves the selection marker with arrow keys onto a real, intact row", async () => {
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
      stdin.push("/");
      await sleep(200);
      stdin.push("\x1b[B\x1b[B\x1b[B"); // down x3 -> /account
      await sleep(250);
      const settleIdx = writes.length;
      await sleep(700);
      const frame = latestFrame(writes.slice(settleIdx));

      expect(countOccurrences(frame, "> /account")).toBe(1);
      expect(countOccurrences(frame, "> /settings")).toBe(0);
      expect(countOccurrences(frame, "View Toolify account")).toBe(1);
      expect(countOccurrences(frame, "/account")).toBe(1);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("keeps the input + status bars below the open menu", async () => {
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
      stdin.push("/");
      await sleep(250);
      const settleIdx = writes.length;
      await sleep(700);
      const frame = latestFrame(writes.slice(settleIdx));
      const lines = frame.split("\n");

      const inputIndex = inputRow(lines);
      const statusIndex = lines.findIndex((l) => l.includes("Auto-approve off"));
      expect(inputIndex).toBeGreaterThanOrEqual(BOTTOM_PANEL_HEIGHT);
      expect(statusIndex).toBeGreaterThan(inputIndex);
      expect(lines.length).toBeGreaterThanOrEqual(23);
      // Input sits directly under the menu at the same row as without it
      // (the menu simply replaces transcript rows — nothing is squeezed).
      expect(inputIndex).toBe(24 - BOTTOM_PANEL_HEIGHT + 2);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("restores the full transcript budget when the menu closes (Esc)", async () => {
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
      stdin.push("/");
      await sleep(250);
      stdin.push("\x1b"); // Esc closes the slash menu
      await sleep(250);
      const settleIdx = writes.length;
      await sleep(700);
      const frame = latestFrame(writes.slice(settleIdx));
      const lines = frame.split("\n");

      expect(frame).not.toContain("/settings"); // menu is gone
      expect(frame).toContain("You /"); // typed slash stays in the input
      expect(inputRow(lines)).toBe(24 - BOTTOM_PANEL_HEIGHT + 2);
      expect(lines.length).toBeGreaterThanOrEqual(23);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
  it("keeps the menu box content-hugging and stable across every selection state", async () => {
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps()), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    const borderWidth = async (): Promise<number> => {
      const idx = writes.length;
      await sleep(700); // >= 1 blink tick -> a full frame
      const frame = latestFrame(writes.slice(idx));
      const borderLine = frame.split("\n").find((l) => l.includes("\u256d"));
      return borderLine ? borderLine.replace(/^\s+/, "").length : -1;
    };
    try {
      await sleep(200);
      stdin.push("/");
      await sleep(250);

      // Every selection state renders the SAME border: 14 + 1 + 31 + 5 = 51
      // (the widest row, /usage). The box must never shrink-to-fit or jump
      // size as the window scrolls.
      expect(await borderWidth()).toBe(51);
      stdin.push("\x1b[B\x1b[B\x1b[B");
      await sleep(120);
      expect(await borderWidth()).toBe(51);
      stdin.push("\x1b[B\x1b[B\x1b[B\x1b[B");
      await sleep(120);
      expect(await borderWidth()).toBe(51);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
  it("shrinks the box to fit the filtered words (/h -> 45 cols)", async () => {
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(React.createElement(ChatUI, baseProps()), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    const borderWidth = async (): Promise<number> => {
      const idx = writes.length;
      await sleep(700);
      const frame = latestFrame(writes.slice(idx));
      const borderLine = frame.split("\n").find((l) => l.includes("\u256d"));
      return borderLine ? borderLine.replace(/^\s+/, "").length : -1;
    };
    try {
      await sleep(200);
      stdin.push("/");
      await sleep(120);
      stdin.push("h"); // filter to /help + /history (longest desc: 25)
      await sleep(250);
      // Box hugs just the filtered words: 14 + 1 + 25 + 5 = 45.
      expect(await borderWidth()).toBe(45);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
});
