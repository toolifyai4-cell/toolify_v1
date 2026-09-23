import { rm } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Vitest global setup: automatically cleans temporary driver/debug files
 * created during smoke test runs (before the suite and again on teardown),
 * so stray `_fix*.cjs` / `*-out.txt` / `.tmp-smoke` artifacts never pile up
 * in the workspace root.
 */

const TEMP_ARTIFACTS = [
  ".tmp-smoke",
  "nexipi-out.txt",
  "vitest-out.txt",
  "npm-out.txt",
  "_test.out",
  "_test.err",
  "_result.json",
];

export async function cleanupTempArtifacts(root: string = process.cwd()): Promise<void> {
  for (const rel of TEMP_ARTIFACTS) {
    await rm(resolve(root, rel), { recursive: true, force: true }).catch(() => {
      /* best-effort: never fail the suite over cleanup */
    });
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await cleanupTempArtifacts();
  return async () => {
    await cleanupTempArtifacts();
  };
}
