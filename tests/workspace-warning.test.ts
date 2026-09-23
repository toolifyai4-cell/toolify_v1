import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workspaceWarnings } from "../src/cli/run.js";

/**
 * Tests for the workspace sanity warnings shown before the chat UI opens.
 * Guards against silently running the agent in a scratch/temp folder
 * (e.g. a leftover test-fixture path like C:\tmp\nexipi-fresh).
 */

let createdDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs = [];
});

describe("workspaceWarnings", () => {
  it("warns when the folder has no project markers at all", async () => {
    const dir = await makeTempDir("nexipi-empty-");
    const warnings = workspaceWarnings(dir);
    expect(warnings.some((w) => w.includes("does not look like a project folder"))).toBe(true);
    // guidance on how to fix it is always appended when there are warnings
    expect(warnings.some((w) => w.includes("--workspace <dir>"))).toBe(true);
  });

  it("does not warn when a package.json is present", async () => {
    const dir = await makeTempDir("nexipi-proj-");
    await writeFile(join(dir, "package.json"), "{}\n", "utf8");
    // mkdtemp lives under the OS temp dir, but the project marker check
    // should pass; only the temp-path heuristic may fire, so verify the
    // "not a project folder" warning specifically is gone.
    const warnings = workspaceWarnings(dir);
    expect(warnings.some((w) => w.includes("does not look like a project folder"))).toBe(false);
  });

  it("does not warn when a .nexipi folder is present", async () => {
    const dir = await makeTempDir("nexipi-configured-");
    await mkdir(join(dir, ".nexipi"));
    const warnings = workspaceWarnings(dir);
    expect(warnings.some((w) => w.includes("does not look like a project folder"))).toBe(false);
  });

  it("flags temp-looking paths like C:\\tmp\\nexipi-fresh", () => {
    const warnings = workspaceWarnings(resolve("C:\\tmp\\nexipi-fresh"));
    expect(warnings.some((w) => w.includes("temporary directory"))).toBe(true);
  });

  it("flags the OS temp directory itself", async () => {
    const dir = await makeTempDir("nexipi-anything-");
    const warnings = workspaceWarnings(dir);
    expect(warnings.some((w) => w.includes("temporary directory"))).toBe(true);
  });

  it("returns no warnings for a real project in a normal folder", () => {
    // Vitest runs from the repo root (C:\NEXIPI_V1), which has package.json
    // and .git and is not a temp-looking path — it must produce zero warnings.
    expect(workspaceWarnings(resolve(process.cwd()))).toEqual([]);
  });
});
