import { readFileSync, writeFileSync } from "fs";
const f = "C:\\TOOLIFY_V1\\src\\components\\ModelsTab.tsx";
const s = readFileSync(f, "utf8");
// Normalize CRLF
const hadCRLF = s.includes("\r\n");
const lines = s.split(hadCRLF ? "\r\n" : "\n");
// Find the return statement inside the ModelsTab component render and fix indentation.
// Locate the line that is just whitespace+ "return ("
let ri = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*return\s*\($/.test(lines[i])) {
    ri = i;
  }
}
if (ri === -1) throw new Error("return line not found");
// The return should be at 2 spaces. Find the start of the outer Box that follows.
// Set indentation of 'return (' to 2 spaces.
lines[ri] = "  return (";
// From return+1, re-indent the block based on a simple nesting approach using angle brackets.
let indent = 2; // current target indent for next line (in spaces)
const openRe = /<$/;
const closeRe = /^<\//;
const selfCloseRe = /\/>$/;
// Determine per-line desired indent by counting open/close tags.
let depth = 0;
for (let i = ri + 1; i < lines.length; i++) {
  const raw = lines[i];
  if (raw.trim() === "") {
    continue;
  }
  let tagDepth = 0;
  // If line opens/closes, adjust. We'll just compute based on leading tag.
  const trimmed = raw.trimStart();
  const indentLevel = raw.length - trimmed.length;
  const isClosing = trimmed.startsWith("</");
  const isSelfClose = selfCloseRe.test(trimmed);
  const isOpen = !isClosing && !isSelfClose && openRe.test(trimmed);
  // Re-indent:
  if (isClosing) {
    depth--;
    if (depth < 0) depth = 0;
    lines[i] = "  ".repeat(depth) + "  " + trimmed; // closing one level deeper than parent? Actually closing aligns with opening tag.
    lines[i] = "  ".repeat(depth) + trimmed;
  } else {
    lines[i] = "  ".repeat(depth + 1) + trimmed;
    if (isOpen) depth++;
  }
}
writeFileSync(f, lines.join(hadCRLF ? "\r\n" : "\n"));
console.log("return at line", ri + 1);
