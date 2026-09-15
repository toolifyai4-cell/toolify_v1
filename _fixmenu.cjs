const fs = require("fs");
const CRLF = "\r\n";
const p = "C:/TOOLIFY_V1/src/components/MenuScreen.tsx";

let c = fs.readFileSync(p, "utf8");
const before = c;
const missed = [];

// 1. import useWindowSize
const impFind = 'import { Box, Text, useInput } from "ink";';
const impRepl = 'import { Box, Text, useInput, useWindowSize } from "ink";';
if (c.includes(impFind)) c = c.split(impFind).join(impRepl);
else missed.push("import line");

// 2. read the real terminal rows inside the component
const hookFind =
  '  const [section, setSection] = React.useState<"home" | "providers" | "history" | "models" | "usage">("home");';
if (c.includes(hookFind)) {
  c = c.split(hookFind).join(
    hookFind + CRLF +
    "  // Ink only sets a WIDTH on the root node, so percentage heights never" + CRLF +
    "  // resolve; read the real terminal rows to pin the footer to the bottom." + CRLF +
    "  const { rows } = useWindowSize();",
  );
} else {
  missed.push("section state anchor");
}

// 3. every percentage root height -> numeric rows
const hFind = '<Box flexDirection="column" height="100%">';
const hCount = c.split(hFind).length - 1;
c = c.split(hFind).join('<Box flexDirection="column" height={rows}>');

if (missed.length > 0) {
  console.error("MISSED:");
  for (const m of missed) console.error("  " + m);
  process.exit(1);
}
if (c === before) {
  console.error("no change");
  process.exit(1);
}
fs.writeFileSync(p, c, "utf8");

const out = fs.readFileSync(p, "utf8");
console.log("import updated:", out.includes("useInput, useWindowSize"));
console.log("hook added:", out.includes("const { rows } = useWindowSize();"));
console.log("height={rows} occurrences:", (out.match(/height=\{rows\}/g) || []).length);
console.log("remaining height=\"100%\":", (out.match(/height="100%"/g) || []).length);
console.log("replaced:", hCount);