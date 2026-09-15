const fs = require("fs");
const BS = String.fromCharCode(92); // single backslash, no shell/JSON escaping traps
const ESC = BS + "u001b";           // the 6-char escape text as written in the source
const p = "C:/TOOLIFY_V1/src/cli/screen.ts";

let c = fs.readFileSync(p, "utf8");
const before = c;

const reps = [
  [
    "export function takeOverScreen(): void {",
    "export function takeOverScreen(stream: NodeJS.WriteStream = process.stdout): void {",
  ],
  [
    '  process.stdout.write("' + ESC + "[?25l",
    '  stream.write("' + ESC + "[?25l",
  ],
  [
    "export function clearScreen(): void {",
    "export function clearScreen(stream: NodeJS.WriteStream = process.stdout): void {",
  ],
  [
    '  process.stdout.write("' + ESC + "[2J",
    '  stream.write("' + ESC + "[2J",
  ],
];

const missed = [];
for (const [find, repl] of reps) {
  if (!c.includes(find)) {
    missed.push(find);
    continue;
  }
  c = c.split(find).join(repl);
}

if (missed.length > 0) {
  console.error("MISSED:");
  for (const m of missed) console.error("  " + JSON.stringify(m));
  process.exit(1);
}
if (c === before) {
  console.error("no change");
  process.exit(1);
}

fs.writeFileSync(p, c, "utf8");

const out = fs.readFileSync(p, "utf8");
console.log("has takeOverScreen(stream):", out.includes("export function takeOverScreen(stream: NodeJS.WriteStream = process.stdout): void {"));
console.log("has clearScreen(stream):", out.includes("export function clearScreen(stream: NodeJS.WriteStream = process.stdout): void {"));
console.log("remaining process.stdout.write in clearScreen/takeOverScreen:", (out.match(/process\.stdout\.write/g) || []).length, "(expect 0)");
console.log("--- functions ---");
const L = out.split(/\r?\n/);
for (let i = 28; i < 45 && i < L.length; i++) console.log((i + 1) + ": " + L[i]);