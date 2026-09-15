import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render, Text } from "ink";
import { clearScreen, takeOverScreen, patchTtyForFullScreen } from "../src/cli/screen.js";

/**
 * Regression tests for the "stacked screens" bug.
 *
 * `startEntryFlow` renders splash -> sign-in -> chat as separate Ink roots.
 * Ink's `unmount()` leaves the last painted frame on screen and each
 * `render()` draws at the current cursor, so WITHOUT an explicit clear every
 * step's box stayed visible behind the next one (the sign-in boxes were still
 * on screen underneath the chat UI).
 *
 * Ink's `instance.clear()` is a silent no-op unless Ink is interactive, so
 * `clearScreen()` (raw ANSI) is what actually guarantees the erase.
 */

function fakeStdout(isTTY = true) {
  const writes: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      writes.push(chunk.toString());
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stream, { isTTY, columns: 80, rows: 24 });
  return { stream, writes };
}

function fakeStdin() {
  const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  return stdin;
}

const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

describe("screen helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("clearScreen erases the visible screen and homes the cursor", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as never);

    clearScreen();

    expect(writes.join("")).toBe("\u001b[2J\u001b[H");
  });

  it("clearScreen does not wipe the scrollback buffer", () => {
    const { stream, writes } = fakeStdout();
    clearScreen(stream);
    expect(writes.join("")).not.toContain("\u001b[3J");
  });

  it("takeOverScreen wipes screen and scrollback and restores the cursor", () => {
    const { stream, writes } = fakeStdout();
    takeOverScreen(stream);
    const out = writes.join("");
    expect(out).toContain("\u001b[?25l"); // hide cursor
    expect(out).toContain("\u001b[2J");   // clear screen
    expect(out).toContain("\u001b[3J");   // clear scrollback
    expect(out).toContain("\u001b[H");    // home cursor
    expect(out).toContain("\u001b[?25h"); // show cursor
  });

  it("patchTtyForFullScreen forces the TTY flags Ink looks at", () => {
    const beforeOut = process.stdout.isTTY;
    const beforeIn = process.stdin.isTTY;
    patchTtyForFullScreen();
    expect(process.stdout.isTTY).toBe(true);
    expect(process.stdin.isTTY).toBe(true);
    Object.defineProperty(process.stdout, "isTTY", { value: beforeOut, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: beforeIn, configurable: true });
  });
});

describe("entry-flow frame clearing (regression)", () => {
  it("erases the previous frame before painting the next screen", async () => {
    const { stream, writes } = fakeStdout();
    const stdin = fakeStdin();
    const options = { stdout: stream, stdin, exitOnCtrlC: false, interactive: true } as const;

    const first = render(React.createElement(Text, null, "SCREEN-ONE"), options);
    await tick();
    first.clear();
    first.unmount();
    clearScreen(stream); // <- the fix
    await tick();

    const second = render(React.createElement(Text, null, "SCREEN-TWO"), options);
    await tick();
    second.unmount();
    await tick();

    const all = writes.join("");
    const one = all.indexOf("SCREEN-ONE");
    const erase = all.indexOf("\u001b[2J");
    const two = all.indexOf("SCREEN-TWO");

    expect(one).toBeGreaterThanOrEqual(0);
    expect(two).toBeGreaterThanOrEqual(0);
    // an erase must land between the two screens, otherwise they stack
    expect(erase).toBeGreaterThan(one);
    expect(erase).toBeLessThan(two);
  });
});