import { BALL_ACTIVE, BALL_IDLE } from "./src/components/ChatUI.js";

console.log("BALL_ACTIVE:", JSON.stringify(BALL_ACTIVE), "len=" + BALL_ACTIVE.length,
  "codepoint=0x" + (BALL_ACTIVE.codePointAt(0) ?? 0).toString(16));
console.log("BALL_IDLE:  ", JSON.stringify(BALL_IDLE), "len=" + BALL_IDLE.length,
  "codepoint=0x" + (BALL_IDLE.codePointAt(0) ?? 0).toString(16));
console.log("expected:   U+25CF (black circle) and U+25CB (white circle), len=1 each");

const ok = BALL_ACTIVE.length === 1 && BALL_ACTIVE.codePointAt(0) === 0x25cf
  && BALL_IDLE.length === 1 && BALL_IDLE.codePointAt(0) === 0x25cb;
console.log(ok ? "BALL GLYPHS OK" : "BALL GLYPHS WRONG");
process.exitCode = ok ? 0 : 1;