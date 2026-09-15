const fs = require("fs");
const BS = String.fromCharCode(92); // a single backslash, without shell/JSON escaping headaches
const p = "C:/TOOLIFY_V1/src/components/ChatUI.tsx";
let c = fs.readFileSync(p, "utf8");

const fixes = [
  ['BALL_ACTIVE = "' + BS + BS + 'u25cf"', 'BALL_ACTIVE = "' + BS + 'u25cf"'],
  ['BALL_IDLE = "' + BS + BS + 'u25cb"', 'BALL_IDLE = "' + BS + 'u25cb"'],
];
for (const [bad, good] of fixes) {
  if (!c.includes(bad)) {
    console.error("NOT FOUND:", bad);
    process.exit(1);
  }
  c = c.split(bad).join(good);
}
fs.writeFileSync(p, c, "utf8");

const after = fs.readFileSync(p, "utf8");
console.log("single-escape present:", after.includes(BS + "u25cf"), after.includes(BS + "u25cb"));
console.log("double-escape gone:", !after.includes(BS + BS + "u25cf") && !after.includes(BS + BS + "u25cb"));
for (const line of after.split(/\r?\n/)) {
  if (line.includes("BALL_")) console.log("  " + JSON.stringify(line));
}