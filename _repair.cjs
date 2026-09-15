const fs = require("fs");
const CRLF = "\r\n";
const NUL = String.fromCharCode(0);
const p = "C:/TOOLIFY_V1/src/cli/chat.tsx";

let c = fs.readFileSync(p, "utf8");

// The previous patch deleted "clearScreen();" and "const { unmount } = render"
// (PowerShell expanded the $1/$3 backreferences in the replacement string) and
// left a stray NUL byte. Restore the exact original line, minus the blank lines.
const broken = "  " + CRLF + NUL + "(React.createElement(ChatHost";
if (!c.includes(broken)) {
  console.error("repair marker not found - aborting");
  process.exit(1);
}
const fixed =
  "  clearScreen();" + CRLF + CRLF +
  "  const { unmount } = render(React.createElement(ChatHost";

c = c.split(broken).join(fixed);
fs.writeFileSync(p, c, "utf8");

const out = fs.readFileSync(p, "utf8");
console.log("NUL count now:", (out.match(new RegExp(NUL, "g")) || []).length);
console.log("has clearScreen();", out.includes("clearScreen();"));
console.log("has const { unmount } = render", out.includes("const { unmount } = render("));
const L = out.split(/\r?\n/);
console.log("--- startChat ---");
for (let i = 237; i < 255 && i < L.length; i++) console.log((i + 1) + ": " + L[i]);