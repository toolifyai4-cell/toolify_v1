import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Build-integrity guard.
 *
 * A careless patch script once left an unterminated JSX comment in
 * src/components/ChatUI.tsx, so esbuild failed to transform it and EVERY CLI
 * entry point died at startup with:
 *   "src/components/ChatUI.tsx:176:10: ERROR: Unterminated regular expression"
 *
 * `npm run typecheck` (tsc --noEmit over src) did not catch it because the
 * failure surfaced through the esbuild/tsx pipeline used to run the CLI.
 * These tests parse every source file the same way the runtime does, plus a
 * self-check proving the guard actually detects that regression.
 */

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(projectRoot, "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/** Parse-only (syntactic) diagnostics — same parse step esbuild performs. */
function syntaxErrors(fileName: string, source: string): string[] {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName,
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const where = d.file && d.start !== undefined
        ? ` (line ${d.file.getLineAndCharacterOfPosition(d.start).line + 1})`
        : "";
      return `${ts.flattenDiagnosticMessageText(d.messageText, "\n")}${where}`;
    });
}

const sourceFiles = walkSourceFiles(srcDir);

describe("source build integrity", () => {
  it("enumerates the src tree", () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
    expect(sourceFiles.some((f) => f.endsWith("ChatUI.tsx"))).toBe(true);
  });

  it("every src module parses as valid TypeScript/TSX (no syntax errors)", () => {
    const failures: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      const errors = syntaxErrors(file, source);
      if (errors.length > 0) {
        failures.push(`${file}: ${errors.join("; ")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("no src file contains a U+FFFD replacement character", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      if (source.includes("\uFFFD")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("detects the regression that broke the CLI (self-check)", () => {
    const unterminatedJsxComment = [
      "import React from \"react\";",
      "export const Broken = () => (",
      "  <div>",
      "    {/* Hint line *",
      "    <span>hi</span>",
      "  </div>",
      ");",
      "",
    ].join("\n");
    expect(syntaxErrors("Broken.tsx", unterminatedJsxComment).length).toBeGreaterThan(0);

    const validJsxComment = unterminatedJsxComment.replace("{/* Hint line *", "{/* Hint line */}");
    expect(syntaxErrors("Good.tsx", validJsxComment)).toEqual([]);
  });
});