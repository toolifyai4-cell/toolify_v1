import { render } from "ink";
import React from "react";
import { Box, Text } from "ink";
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

console.log("Starting simple ink test");
const { stream, writes } = makeStdout(24, 80);
const stdin = makeStdin();
const instance = render(React.createElement(Box, null, React.createElement(Text, null, "Hello")), {
  stdout: stream,
  stdin,
  exitOnCtrlC: false,
  interactive: true,
});
console.log("After render, before unmount");
instance.unmount();
console.log("After unmount");
console.log("Writes length:", writes.length);
console.log("Joined:", writes.join(""));