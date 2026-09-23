import { describe, it, expect } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import { ChatUI, type ChatUIProps } from "../src/components/ChatUI.js";

/**
 * Quit-shortcut regression: Ctrl+Shift+Backspace must call onExit.
 * The Shift combo passes through VS Code untouched (plain Ctrl+Backspace is
 * intercepted there for "delete word left"). When the terminal speaks the
 * kitty keyboard protocol (VS Code, Windows Terminal, iTerm2) it encodes the
 * modifier bits and ink decodes them into a distinguishable key object:
 *   plain Backspace       -> key.ctrl=false, key.shift=false
 *   Ctrl+Backspace        -> key.ctrl=true,  key.shift=false  (delete word left)
 *   Ctrl+Shift+Backspace  -> key.ctrl=true,  key.shift=true   (QUIT)
 * On legacy xterm the combo arrives bare as Ctrl+/ (0x1f).
 * Plain Backspace (0x7f) MUST NOT quit: ink delivers it identically to
 * Ctrl+Shift+Backspace (ch="" + key.backspace=true, key.ctrl=false), so
 * quitting on it would eat every delete-char keystroke.
 * Plain Ctrl+W (0x17 — what VS Code turns plain Ctrl+Backspace into) must
 * NOT quit: that caused accidental exits and is now reserved for nothing.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function quitTestStdout() {
  const writes: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      writes.push(chunk.toString());
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stream, { isTTY: true, columns: 80, rows: 24 });
  return { stream, writes };
}

function quitTestStdin() {
  const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  return stdin;
}

function quitTestProps(overrides: Partial<ChatUIProps> = {}): ChatUIProps {
  return {
    messages: [],
    status: { model: "gpt-4o", inputTokens: 0, outputTokens: 0, turnCount: 0 },
    mode: "act",
    autoApprove: "off",
    workspace: "C:\\tmp\\nexipi-fresh",
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

describe("ChatUI quit shortcut (Ctrl+Shift+Backspace)", () => {
  it("calls onExit for Ctrl+/ (0x1f, legacy quit key)", async () => {
    let exits = 0;
    const stdin = quitTestStdin();
    const { stream } = quitTestStdout();
    const instance = render(React.createElement(ChatUI, quitTestProps({ onExit: () => { exits += 1; } })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(150);
      stdin.push("\x1f");
      await sleep(150);
      await instance.waitUntilRenderFlush();
      expect(exits).toBe(1);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("calls onExit for kitty Ctrl+Shift+Backspace (\\x1b[127;6u)", async () => {
    let exits = 0;
    const stdin = quitTestStdin();
    const { stream } = quitTestStdout();
    const instance = render(React.createElement(ChatUI, quitTestProps({ onExit: () => { exits += 1; } })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(150);
      stdin.push("\x1b[127;6u"); // kitty: Backspace + Ctrl + Shift
      await sleep(150);
      await instance.waitUntilRenderFlush();
      expect(exits).toBe(1);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("does NOT quit on kitty Ctrl+Backspace (\\x1b[127;5u) — that is delete word left", async () => {
    let exits = 0;
    const stdin = quitTestStdin();
    const { stream } = quitTestStdout();
    const instance = render(React.createElement(ChatUI, quitTestProps({ onExit: () => { exits += 1; } })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(150);
      stdin.push("\x1b[127;5u"); // kitty: Backspace + Ctrl (no Shift)
      await sleep(150);
      await instance.waitUntilRenderFlush();
      expect(exits).toBe(0);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("does NOT quit on plain Backspace (0x7f) — even on win32, where it is byte-identical to Ctrl+Shift+Backspace", async () => {
    const platformDesc = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      let exits = 0;
      const stdin = quitTestStdin();
      const { stream } = quitTestStdout();
      const instance = render(React.createElement(ChatUI, quitTestProps({ onExit: () => { exits += 1; } })), {
        stdout: stream,
        stdin,
        exitOnCtrlC: false,
        interactive: true,
      });
      try {
        await sleep(150);
        stdin.push("\x7f"); // plain Backspace — deletes a char, never quits
        await sleep(150);
        await instance.waitUntilRenderFlush();
        expect(exits).toBe(0);
      } finally {
        instance.unmount();
        await sleep(50);
      }
    } finally {
      if (platformDesc) Object.defineProperty(process, "platform", platformDesc);
    }
  });

  it("does NOT quit on plain Ctrl+W (0x17) — that is VS Code's rewrite of Ctrl+Backspace", async () => {
    let exits = 0;
    const stdin = quitTestStdin();
    const { stream } = quitTestStdout();
    const instance = render(React.createElement(ChatUI, quitTestProps({ onExit: () => { exits += 1; } })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(150);
      stdin.push("\x17");
      await sleep(150);
      await instance.waitUntilRenderFlush();
      expect(exits).toBe(0);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("does not quit on ordinary typing keys", async () => {
    let exits = 0;
    const stdin = quitTestStdin();
    const { stream } = quitTestStdout();
    const instance = render(React.createElement(ChatUI, quitTestProps({ onExit: () => { exits += 1; } })), {
      stdout: stream,
      stdin,
      exitOnCtrlC: false,
      interactive: true,
    });
    try {
      await sleep(150);
      stdin.push("hello");
      await sleep(150);
      await instance.waitUntilRenderFlush();
      expect(exits).toBe(0);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
});
