import React from "react";
import { Readable, Writable } from "node:stream";
import { render, Text } from "ink";

function makeFakeStdout(isTTY: boolean) {
  const writes: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      writes.push(chunk.toString());
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stream, { isTTY, columns: 60, rows: 24 });
  return { stream, writes };
}

function makeFakeStdin() {
  const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  return stdin;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(label: string, isTTY: boolean, clearBeforeUnmount: boolean) {
  const { stream, writes } = makeFakeStdout(isTTY);
  const stdin = makeFakeStdin();

  const r1 = render(React.createElement(Text, null, "FRAME-ONE"), { stdout: stream, stdin, exitOnCtrlC: false });
  await wait(150);
  if (clearBeforeUnmount) r1.clear();
  r1.unmount();
  await wait(150);

  const phase2Start = writes.length;

  const r2 = render(React.createElement(Text, null, "FRAME-TWO"), { stdout: stream, stdin, exitOnCtrlC: false });
  await wait(150);
  r2.unmount();
  await wait(150);

  const all = writes.join("");
  const phase2 = writes.slice(phase2Start).join("");
  console.log(`\n===== ${label} (isTTY=${isTTY}, clear()=${clearBeforeUnmount}) =====`);
  console.log("  phase2 has erase/cursor seqs:",
    phase2.includes("\u001b[2K") || phase2.includes("\u001b[1A") || phase2.includes("\u001b[2J"));
  console.log("  WHOLE stream has erase-line (ESC[2K):", all.includes("\u001b[2K"));
  console.log("  WHOLE stream has cursor-up (ESC[1A):", all.includes("\u001b[1A"));
  console.log("  phase2 bytes:", JSON.stringify(phase2).slice(0, 220));
}

await run("non-tty, no clear", false, false);
await run("non-tty, with clear", false, true);
await run("tty, no clear", true, false);
await run("tty, with clear", true, true);