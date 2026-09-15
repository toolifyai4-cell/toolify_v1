const fs = require("fs");
const CRLF = "\r\n";
const failures = [];

function patch(path, replacements, assertions) {
  let c = fs.readFileSync(path, "utf8");
  for (const [label, find, replace] of replacements) {
    if (find instanceof RegExp) {
      if (!find.test(c)) { failures.push(path + ": regex not found -> " + label); continue; }
      c = c.replace(find, replace);
    } else {
      if (!c.includes(find)) { failures.push(path + ": text not found -> " + label); continue; }
      c = c.split(find).join(replace);
    }
  }
  fs.writeFileSync(path, c, "utf8");
  if (assertions) {
    for (const [label, ok] of assertions(c)) if (!ok) failures.push(path + ": assertion -> " + label);
  }
  console.log("patched " + path);
}

// ---------------------------------------------------------------- entry-new.tsx
const ENTRY = "src/cli/entry-new.tsx";

const endStepBlock = [
  "/**",
  " * Retire a finished full-screen step.",
  " *",
  " * Ink's unmount() tears the React tree down but LEAVES the last painted frame",
  " * on screen, and every render() draws at the current cursor position - so",
  " * without an explicit clear, each step (splash, sign-in, chat) stacked on top",
  " * of the previous one. clearScreen() is the guarantee, because instance.clear()",
  " * is a silent no-op whenever Ink is not in interactive mode.",
  " */",
  "function endStep(instance: Instance): void {",
  "  instance.clear();",
  "  instance.unmount();",
  "  clearScreen();",
  "}",
].join(CRLF);

patch(
  ENTRY,
  [
    [
      "screen import",
      'import { DIM, GREEN, CYAN, YELLOW, RESET } from "../components/ChatUI.js";',
      'import { DIM, GREEN, CYAN, YELLOW, RESET } from "../components/ChatUI.js";' + CRLF +
        'import {' + CRLF +
        '  clearScreen,' + CRLF +
        '  patchTtyForFullScreen,' + CRLF +
        '  takeOverScreen,' + CRLF +
        '  FULLSCREEN_RENDER_OPTIONS,' + CRLF +
        '} from "./screen.js";',
    ],
    [
      "replace local tty/screen helpers with endStep",
      /function patchTtyForFullScreen\(\): void \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction takeOverScreen\(\): void \{[\s\S]*?\r?\n\}\r?\n/,
      endStepBlock + CRLF,
    ],
    ["render instance", "const { unmount } = render(", "const instance = render("],
    ["splash/welcome done", "unmount(); resolve(); }}", "endStep(instance); resolve(); }}"],
    ["auth pick", "unmount(); resolve({ provider }); }}", "endStep(instance); resolve({ provider }); }}"],
    ["auth cancel", "unmount(); resolve(null); }}", "endStep(instance); resolve(null); }}"],
    ["render options", /(\s*)\{ exitOnCtrlC: false \},/g, "$1FULLSCREEN_RENDER_OPTIONS,"],
    ["tagline", "Plan vs Act modes - verification gate", "Plan vs Build modes - verification gate"],
  ],
  (c) => [
    ["endStep defined", c.includes("function endStep(instance: Instance): void {")],
    ["old tty helper removed", !c.includes("function patchTtyForFullScreen(): void {")],
    ["old takeOverScreen removed", !c.includes("function takeOverScreen(): void {")],
    ["no bare unmount() left", !c.includes("unmount(); resolve")],
    ["4 instances", (c.match(/const instance = render\(/g) || []).length === 4],
    ["4 render options", (c.match(/FULLSCREEN_RENDER_OPTIONS,/g) || []).length === 4],
    ["no exitOnCtrlC left", !c.includes("exitOnCtrlC: false")],
    ["takeOverScreen still called", c.includes("takeOverScreen();")],
    ["patchTty still called", c.includes("patchTtyForFullScreen();")],
  ],
);

// ------------------------------------------------------------------- chat.tsx
const CHAT = "src/cli/chat.tsx";

patch(
  CHAT,
  [
    [
      "screen import",
      'import { ChatUI, type ChatMessage } from "../components/ChatUI.js";',
      'import { ChatUI, type ChatMessage } from "../components/ChatUI.js";' + CRLF +
        'import { clearScreen, patchTtyForFullScreen } from "./screen.js";',
    ],
    [
      "drop stdout tty hack",
      '  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });',
      "",
    ],
    [
      "drop stdin tty hack",
      '  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });',
      "",
    ],
    [
      "comment + clear before chat",
      "  // Force Ink into full-screen mode. On Windows, npx/tsx often reports",
      "  // Ink only erases its frame in interactive mode, and npx/tsx on Windows" + CRLF +
        "  // often reports isTTY=false even inside a real terminal, so force it on." + CRLF +
        "  patchTtyForFullScreen();" + CRLF +
        "  // Wipe the entry flow's final frame so the chat starts on a clean screen." + CRLF +
        "  clearScreen();",
    ],
    ["blank line tidy", "  // process.stdout.isTTY=false, which makes Ink skip full-screen rendering.", ""],
    ["collapse blanks", /\r?\n\r?\n\r?\n(\s*const \{ unmount \} = render)/, CRLF + CRLF + "$1"],
    [
      "force interactive",
      /(\s*)exitOnCtrlC: false,/g,
      "$1exitOnCtrlC: false," + CRLF + "$1interactive: true,",
    ],
  ],
  (c) => [
    ["screen import present", c.includes('from "./screen.js";')],
    ["tty patch used", c.includes("patchTtyForFullScreen();")],
    ["clearScreen used", c.includes("clearScreen();")],
    ["no defineProperty left", !c.includes("Object.defineProperty(process.stdout, \"isTTY\"")],
    ["interactive true", c.includes("interactive: true,")],
  ],
);

// ------------------------------------------------------ OnboardingWizard.tsx
patch("src/components/OnboardingWizard.tsx", [
  ["tagline", "Plan vs Act modes - verification gate", "Plan vs Build modes - verification gate"],
]);

if (failures.length > 0) {
  console.error(CRLF + "FAILURES:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(CRLF + "ALL FLOW PATCHES OK");