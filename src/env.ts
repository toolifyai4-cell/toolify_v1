/**
 * Environment bootstrap — imported FIRST by src/index.ts so every other
 * module sees the loaded variables (ESM evaluates imports in order).
 *
 * Loads .env from the current folder first (project-local values win), then
 * falls back to the package's own root so OAuth credentials are still found
 * when nexipi is launched from a different directory (e.g. a scratch folder).
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

loadEnv({ quiet: true });

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageEnv = resolve(packageRoot, ".env");
if (existsSync(packageEnv)) {
  loadEnv({ path: packageEnv, override: false, quiet: true });
}
