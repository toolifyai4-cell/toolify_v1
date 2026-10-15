import { render } from "ink";
import React from "react";
import { ChatUI } from "./src/components/ChatUI.tsx";
import { Readable, Writable } from "node:stream";

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

function baseProps() {
  return {
    messages: [],
    status: { model: "gpt-4o", inputTokens: 0, outputTokens: 0, turnCount: 0 },
    mode: "act",
    autoApprove: "off",
    workspace: "C:\\\\TOOLIFY_V1",
    isRunning: false,
    onSubmit: () => {},
    onModeToggle: () => {},
    onAutoApproveToggle: () => {},
    onClear: () => {},
    onExit: () => {},
    onCancel: () => {},
  };
}

function latestFrame(writes: string[]): string {
  const raw = writes.join("");
  // Simple ANSI strip (matches test helper)
  return raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

async function run() {
  console.log("Starting debug render...");
  const { stream, writes } = makeStdout(24, 80);
  const stdin = makeStdin();
  console.log("Before render");
  const instance = render(React.createElement(ChatUI, baseProps()), {
    stdout: stream,
    stdin,
    exitOnCtrlC: false,
    interactive: true,
  });
  console.log("After render");
  try {
    console.log("Waiting 200ms");
    await new Promise(r => setTimeout(r, 200));
    console.log("Pushing '/'");
    stdin.push("/");
    console.log("Waiting 250ms");
    await new Promise(r => setTimeout(r, 250));
    const settleIdx = writes.length;
    console.log("Settle idx:", settleIdx);
    console.log("Waiting 700ms");
    await new Promise(r => setTimeout(r, 700));
    const frame = latestFrame(writes.slice(settleIdx));
    console.log("=== FRAME START ===");
    console.log(frame);
    console.log("=== FRAME END ===");
    console.log("Frame length:", frame.length);
    // Count lines
    const lines = frame.split("\n");
    console.log("Lines count:", lines.length);
    for (let i = 0; i < lines.length; i++) {
      console.log(`${i}: "${lines[i]}"`);
    }
  } finally {
    console.log("Unmounting");
    instance.unmount();
    await new Promise(r => setTimeout(r, 50));
  }
}
run().catch(console.error);