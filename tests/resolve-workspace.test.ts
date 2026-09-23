import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveWorkspace } from "../src/cli/run.js";

/**
 * Tests for workspace auto-detection: the chat UI must open on the real
 * project folder (the one the user has open in VS Code), not whatever
 * scratch directory the process happened to be launched from.
 */

let createdDirs: string[] = [];
const ENV_KEY = "NEXIPI_WORKSPACE";
let savedEnv: string | undefined;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  savedEnv = undefined;
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs = [];
});

function setEnv(value: string | undefined): void {
  if (savedEnv === undefined) savedEnv = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

describe("resolveWorkspace", () => {
  it("explicit flag always wins, even over the env var", async () => {
    const flagDir = await makeTempDir("nexipi-flag-");
    const envDir = await makeTempDir("nexipi-env-");
    setEnv(envDir);
    const result = resolveWorkspace(flagDir);
    expect(result.workspace).toBe(resolve(flagDir));
    expect(result.source).toBe("flag");
  });

  it("uses NEXIPI_WORKSPACE when no flag is given", async () => {
    const envDir = await makeTempDir("nexipi-env-");
    setEnv(envDir);
    const result = resolveWorkspace(undefined, resolve("C:\\some\\scratch"));
    expect(result.workspace).toBe(resolve(envDir));
    expect(result.source).toBe("env");
  });

  it("ignores an empty NEXIPI_WORKSPACE value", async () => {
    const root = await makeTempDir("nexipi-root-");
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    setEnv("   ");
    const result = resolveWorkspace(undefined, root);
    expect(result.workspace).toBe(resolve(root));
    expect(result.source).toBe("cwd");
  });

  it("walks up from a nested subfolder to the project root", async () => {
    const root = await makeTempDir("nexipi-root-");
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    const nested = join(root, "src", "deep", "nested");
    await mkdir(nested, { recursive: true });
    setEnv(undefined);
    const result = resolveWorkspace(undefined, nested);
    expect(result.workspace).toBe(resolve(root));
    expect(result.source).toBe("detected");
  });

  it("recognizes .git and .nexipi as project markers too", async () => {
    const gitRoot = await makeTempDir("nexipi-git-");
    await mkdir(join(gitRoot, ".git"));
    const sub = join(gitRoot, "sub");
    await mkdir(sub);
    setEnv(undefined);
    expect(resolveWorkspace(undefined, sub).workspace).toBe(resolve(gitRoot));

    const nexipiRoot = await makeTempDir("nexipi-cfg-");
    await mkdir(join(nexipiRoot, ".nexipi"));
    const sub2 = join(nexipiRoot, "sub");
    await mkdir(sub2);
    expect(resolveWorkspace(undefined, sub2).workspace).toBe(resolve(nexipiRoot));
  });

  it("returns the cwd itself when it is already a project root", async () => {
    const root = await makeTempDir("nexipi-root-");
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    setEnv(undefined);
    const result = resolveWorkspace(undefined, root);
    expect(result.workspace).toBe(resolve(root));
    expect(result.source).toBe("cwd");
  });

  it("falls back to the cwd unchanged when no markers exist anywhere", async () => {
    const bare = await makeTempDir("nexipi-bare-");
    const nested = join(bare, "a", "b");
    await mkdir(nested, { recursive: true });
    setEnv(undefined);
    // Temp dirs contain no project markers up to the filesystem root... on
    // some machines a drive root could theoretically have one, so only assert
    // the workspace is an ancestor-or-self of the nested dir and source is
    // either "detected" (found something above) or "cwd" (found nothing).
    const result = resolveWorkspace(undefined, nested);
    expect(resolve(nested).startsWith(result.workspace)).toBe(true);
    expect(["detected", "cwd"]).toContain(result.source);
  });

  it("uses the real process cwd by default (repo root has markers, no crash)", () => {
    setEnv(undefined);
    const result = resolveWorkspace();
    expect(typeof result.workspace).toBe("string");
    expect(result.workspace.length).toBeGreaterThan(0);
  });
});
