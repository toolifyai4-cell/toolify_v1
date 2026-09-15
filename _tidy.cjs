const fs = require("fs");
const CRLF = "\r\n";
const p = "src/cli/chat.tsx";
let c = fs.readFileSync(p, "utf8");
const before = c;

// collapse the 3 blank lines left by removing the defineProperty hacks
c = c.replace(/\r?\n\r?\n\r?\n(\s*const \{ unmount \} = render)/, CRLF + CRLF + "$1");
// remove the spurious blank line between exitOnCtrlC and interactive
c = c.replace(/(exitOnCtrlC: false,)(\r?\n)+(\s*)interactive: true,/, "$1" + CRLF + "$3interactive: true,");

if (c === before) {
  console.error("no change made");
  process.exit(1);
}
fs.writeFileSync(p, c, "utf8");
const out = fs.readFileSync(p, "utf8").split(/\r?\n/);
for (let i = 236; i < 256 && i < out.length; i++) console.log((i + 1) + ": " + out[i]);