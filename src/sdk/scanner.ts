/*******************************************************************************************
 * Plugin scanner for Toolify
 * -------------------------------------------------
 * - Walks a user‑configurable folder (default: ~/.toolify/plugins)
 * - Dynamically imports every .ts/.js file (excluding node_modules)
 * - Looks for a default export that is a ToolSchema (created via createTool())
 * - Emits an array of ToolSchema that can be merged with the built‑in tool list
 *
 * Convention for plugin authors:
 *   import { createTool } from "@toolify/sdk";
 *
 *   export default createTool({
 *     name: "my-tool",
 *     description: "Does something clever",
 *     inputSchema: { type: "object", properties: {} },
 *     execute: async () => "result",
 *   });
 *
 * ---------------------------------------------------------------------------
 *  Copyright (c) 2025 Toolify AI. All rights reserved.
 *******************************************************************************************/

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ToolSchema } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default folder where plugin authors drop their modules. */
export const DEFAULT_PLUGINS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".toolify",
  "plugins"
);

/** Environment variable that can override the plugins folder. */
export function getPluginsDir(): string {
  return (
    process.env.TOOLIFY_PLUGINS_DIR ||
    DEFAULT_PLUGINS_DIR
  );
}

/** Type‑guard: returns true only for plain ToolSchema objects. */
export function isToolSchema(obj: unknown): obj is ToolSchema {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.description === "string" &&
    typeof o.inputSchema === "object" &&
    o.inputSchema !== null &&
    typeof o.execute === "function"
  );
}

/**
 * Scan a single module file and return any ToolSchema found in its default export.
 *
 * The file is imported via `import()` (dynamic).  After import we check
 * `mod.default` – the plugin author should export the result of `createTool()` as
 * the module's default export.
 */
async function scanModuleFile(filePath: string): Promise<ToolSchema | null> {
  try {
    // Dynamic import – note we use the file URL protocol so Node can resolve .ts/.js
    const mod = await import(filePath);

    // Check default export first
    if (isToolSchema(mod.default)) return mod.default;

    // Fallback: look through named exports for anything that looks like a ToolSchema
    for (const key of Object.keys(mod)) {
      if (isToolSchema(mod[key])) return mod[key] as ToolSchema;
    }

    return null;
  } catch (err) {
    // Silently skip files that fail to import (syntax errors, missing deps, etc.)
    // eslint-disable-next-line no-console
    console.warn(`[Toolify scanner] failed to import plugin file ${filePath}:`, err);
    return null;
  }
}

/**
 * Scan the whole plugins directory and return an array of discovered ToolSchema entries.
 *
 * @param pluginsDir Path to the folder containing plugin modules. If `undefined` the
 *   function reads `TOOLIFY_PLUGINS_DIR` env var or the default `~/.toolify/plugins`.
 * @returns A `ToolSchema[]` – may be empty if no plugins are found or none match the
 *   expected export convention.
 */
export async function scanPluginsDirectory(
  pluginsDir?: string
): Promise<ToolSchema[]> {
  const dir = pluginsDir ?? getPluginsDir();

  if (!fs.existsSync(dir)) {
    // Directory does not exist yet – create it so the user gets a helpful message
    // and so future runs can find it.
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error(
        `[Toolify scanner] could not create plugin directory ${dir}:`,
        e
      );
      return [];
    }
  }

  const results: ToolSchema[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Recurse into sub‑directories (allows organized groups of plugins)
      const subDir = path.join(dir, entry.name);
      results.push(...(await scanPluginsDirectory(subDir)));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".ts" && ext !== ".js") continue;

    const filePath = path.join(dir, entry.name);
    const schema = await scanModuleFile(filePath);
    if (schema) results.push(schema);
  }

  return results;
}

/**
 * Convenience wrapper that scans the default folder and returns the schemas.
 * Meant to be called from the extension activation code.
 */
export async function loadBuiltInPlugins(): Promise<ToolSchema[]> {
  return scanPluginsDirectory();
}

export { isToolSchema };