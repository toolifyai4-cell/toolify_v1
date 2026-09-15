/**
 * Smoke driver: hosts ChatHost with a mocked TTY stdin/stdout, types
 * "TypedOK" + Enter, then "/exit" + Enter, and asserts landing UI,
 * status bar, input echo, and clean exit.
 */
import React from "react";
import { render } from "ink";
import { EventEmitter } from "node:events";
import { ChatHost } from "../src/cli/chat.js";
import { loadConfig } from "../src/cli/run.js";

const stdoutFrames: string[] = [];
const stderrFrames: string[] = [];

class MockWrite extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true;
  writes: string[] = [];
  write(s: string): boolean {
    this.writes.push(s);
    return true;
  }
}

class MockStdin extends EventEmitter {
  isTTY = true;
  isRawMode = false;
  _buffer = "";
  _readableEmitted = false;

  setEncoding(): this {
    return this;
  }
  setRawMode(): this {
    this.isRawMode = true;
    return this;
  }
  ref(): void {}
  unref(): void {}
  read(): string | null {
    if (this._buffer.length === 0) return null;
    const chunk = this._buffer;
    this._buffer = "";
    this._readableEmitted = false;
    return chunk;
  }
  /**
   * Push a keystroke chunk. Emits 'readable' so Ink's handleReadable
   * callback (which calls stdin.read()) picks it up.
   */
  _push(chunk: string): void {
    this._buffer += chunk;
    if (!this._readableEmitted) {
      this._readableEmitted = true;
      this.emit("readable");
    }
  }
}

process.on("exit", (code) => {
  const all = stdoutFrames.join("");
  const errors = stderrFrames.join("");
  console.log(all.includes("What can I do for you?") ? "LANDING-UI-OK" : "LANDING-UI-MISSING");
  console.log(all.includes("mock-scripted") ? "STATUSBAR-OK" : "STATUSBAR-MISSING");
  console.log(all.includes("TypedOK") ? "INPUT-OK" : "INPUT-MISSING");
  console.log(`SMOKE-EXIT-CODE:${code}`);
  if (errors) console.log(`STDERR-LEN:${errors.length}`);
});

const workspace = "C:/TOOLIFY_V1/.tmp-smoke";
const cfg = await loadConfig(workspace);

const stdin = new MockStdin();
const stdoutMock = new MockWrite();
const stderrMock = new MockWrite();

const instance = render(React.createElement(ChatHost, { workspace, cfg }), {
  stdin: stdin as unknown as NodeJS.ReadStream,
  stdout: stdoutMock as unknown as NodeJS.WriteStream,
  stderr: stderrMock as unknown as NodeJS.WriteStream,
  exitOnCtrlC: false,
  patchConsole: false,
});

// Simulate real keystrokes: push each char so Ink's handleReadable
// (which calls stdin.read()) picks it up via 'readable' events.
const TYPED_OK = "TypedOK";
const CARRIAGE_RETURN = String.fromCharCode(13); // '\r' → parseKeypress → key.return

let i = 0;
const tick = () => {
  if (i < TYPED_OK.length) {
    stdin._push(TYPED_OK[i]);
    i++;
    setTimeout(tick, 30);
  } else {
    // Submit "TypedOK"
    setTimeout(() => stdin._push(CARRIAGE_RETURN), 50);
  }
};

// Let React mount first, then start typing.
setTimeout(tick, 150);

// Wait enough for the mock adapter turn to complete, then /exit.
setTimeout(() => {
  // Emit "/exit" char-by-char via _push (Ink reads from 'readable')
  const EXIT = "/exit";
  let j = 0;
  const typeExit = () => {
    if (j < EXIT.length) {
      stdin._push(EXIT[j]);
      j++;
      setTimeout(typeExit, 20);
    } else {
      setTimeout(() => stdin._push(CARRIAGE_RETURN), 40);
    }
  };
  typeExit();
}, 2500);

// Fail-safe: if /exit didn't terminate us, dump frames and exit 1.
setTimeout(() => {
  console.log("SMOKE-FAIL:no-exit");
  console.log("STDERR:", stderrMock.writes.join("").slice(0, 300));
  console.log("LASTFRAME:", (stdoutFrames[stdoutFrames.length - 1] ?? "").slice(0, 600));
  instance.unmount();
  process.exit(1);
}, 7000);
