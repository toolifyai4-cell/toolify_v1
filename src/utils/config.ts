import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";

/**
 * Toolify persistent credential store.
 *
 * Reads/writes `~/.toolify/config.json` with strict 0600 permissions so API
 * keys never leak into version control or shared terminals.
 *
 * Credential resolution order (highest → lowest priority):
 *   1. process.env[PROVIDER_ENV_VAR]
 *   2. local workspace .env file
 *   3. ~/.toolify/config.json
 */

export const TOOLIFY_DIR = ".toolify";
export const TOOLIFY_CONFIG_FILE = "config.json";
export const TOOLIFY_CONFIG_MODE = 0o600;

/** Every provider the catalog supports, keyed by its canonical id. */
export const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  cohere: "COHERE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  omniroute: "OMNIROUTE_API_KEY",
  unoroute: "UNOROUTE_API_KEY",
  litellm: "LITELLM_API_KEY",
  ollama: "OLLAMA_API_KEY",
  lmstudio: "LMSTUDIO_API_KEY",
  vllm: "VLLM_API_KEY",
  jan: "JAN_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  gemini: "GEMINI_API_KEY",
};

/**
 * Default base URLs for the chat adapter (createAdapter) and for resolving
 * provider credentials. Local runners point at their own ports; cloud
 * providers use their OpenAI-compatible `/chat/completions` endpoints.
 * Gemini's chat base is Google's OpenAI-compatibility layer (Bearer auth),
 * which is distinct from the native verification endpoint in
 * `models/verify-key.ts`.
 * Static defaults — subject to API provider endpoint drift. Override via
 * environment variables (e.g., OPENAI_BASE_URL, OPENROUTER_BASE_URL).
 */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  perplexity: "https://api.perplexity.ai",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  vllm: "http://localhost:8000/v1",
  litellm: "http://localhost:4000/v1",
  omniroute: "https://api.omniroute.ai/v1",
  unoroute: "https://api.unoroute.dev/v1",
  jan: "",
};

export interface ToolifyConfig {
  apiKeys: Record<string, string>;
  baseUrls: Record<string, string>;
  /** Persisted UI theme id (see src/theme/themes.ts). */
  theme?: string;
}

function configDir(): string {
  return resolve(homedir(), TOOLIFY_DIR);
}

function configPath(): string {
  return resolve(homedir(), TOOLIFY_DIR, TOOLIFY_CONFIG_FILE);
}

/** Ensure ~/.toolify/ exists and config.json is present (mode 0600). */
export async function ensureConfigDir(): Promise<void> {
  const dir = configDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const path = configPath();
  if (!existsSync(path)) {
    await writeFile(path, JSON.stringify({ apiKeys: {}, baseUrls: {} }, null, 2), {
      mode: TOOLIFY_CONFIG_MODE,
    });
  }
}

/** Read the global config file (creates it if missing). */
export async function readConfig(): Promise<ToolifyConfig> {
  await ensureConfigDir();
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ToolifyConfig>;
    return {
      apiKeys: parsed.apiKeys ?? {},
      baseUrls: parsed.baseUrls ?? {},
    };
  } catch {
    return { apiKeys: {}, baseUrls: {} };
  }
}

/** Write the global config file atomically with mode 0600. */
export async function writeConfig(cfg: ToolifyConfig): Promise<void> {
  await ensureConfigDir();
  const tmp = configPath() + ".tmp";
  await writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: TOOLIFY_CONFIG_MODE });
  // Rename is atomic on most platforms; falls back to copy+delete.
  try {
    const { rename } = await import("node:fs/promises");
    await rename(tmp, configPath());
  } catch {
    await writeFile(configPath(), JSON.stringify(cfg, null, 2), { mode: TOOLIFY_CONFIG_MODE });
  }
}

/** Persist a single API key for a provider. */
export async function saveApiKey(provider: string, key: string): Promise<void> {
  const cfg = await readConfig();
  cfg.apiKeys[provider] = key;
  await writeConfig(cfg);
}

/** Persist a single base URL for a provider. */
export async function saveBaseUrl(provider: string, url: string): Promise<void> {
  const cfg = await readConfig();
  cfg.baseUrls[provider] = url;
  await writeConfig(cfg);
}

/**
 * Read a workspace-local `.env` file and return key/value pairs.
 * Lines are `KEY=VALUE`; blank lines and `#` comments are skipped.
 */
export async function readWorkspaceEnv(workspace: string): Promise<Record<string, string>> {
  const envPath = resolve(workspace, ".env");
  if (!existsSync(envPath)) return {};
  try {
    const raw = await readFile(envPath, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve the active API key for a provider using the 3-tier hierarchy:
 *   1. process.env
 *   2. workspace .env
 *   3. ~/.toolify/config.json
 */
export async function resolveApiKey(
  provider: string,
  workspace: string,
): Promise<string | undefined> {
  const envVar = PROVIDER_ENV_VARS[provider];
  if (envVar && process.env[envVar]) return process.env[envVar];

  const workspaceEnv = await readWorkspaceEnv(workspace);
  if (envVar && workspaceEnv[envVar]) return workspaceEnv[envVar];

  const cfg = await readConfig();
  return cfg.apiKeys[provider];
}

/** Resolve the active base URL for a provider. */
export async function resolveBaseUrl(
  provider: string,
  workspace: string,
): Promise<string | undefined> {
  if (process.env[`${provider.toUpperCase()}_BASE_URL`]) {
    return process.env[`${provider.toUpperCase()}_BASE_URL`]!;
  }
  const cfg = await readConfig();
  if (cfg.baseUrls[provider]) return cfg.baseUrls[provider];
  return PROVIDER_BASE_URLS[provider];
}
// --- Synchronous helpers (used by createAdapter during render) ---

function ensureConfigDirSync(): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    try { require("node:fs").mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
  }
  const path = configPath();
  if (!existsSync(path)) {
    try {
      require("node:fs").writeFileSync(
        path,
        JSON.stringify({ apiKeys: {}, baseUrls: {} }, null, 2),
        { mode: TOOLIFY_CONFIG_MODE },
      );
    } catch { /* ignore */ }
  }
}

export function readConfigSync(): ToolifyConfig {
  ensureConfigDirSync();
  const path = configPath();
  if (!existsSync(path)) return { apiKeys: {}, baseUrls: {} };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ToolifyConfig>;
    return { apiKeys: parsed.apiKeys ?? {}, baseUrls: parsed.baseUrls ?? {} };
  } catch {
    return { apiKeys: {}, baseUrls: {} };
  }
}

function readWorkspaceEnvSync(workspace: string): Record<string, string> {
  const envPath = resolve(workspace, ".env");
  if (!existsSync(envPath)) return {};
  try {
    const raw = readFileSync(envPath, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Synchronous credential resolver — same 3-tier hierarchy as the async version,
 * but safe to call from inside React render (createAdapter).
 */
export function resolveApiKeySync(provider: string, workspace: string): string | undefined {
  const envVar = PROVIDER_ENV_VARS[provider];
  if (envVar && process.env[envVar]) return process.env[envVar];

  const workspaceEnv = readWorkspaceEnvSync(workspace);
  if (envVar && workspaceEnv[envVar]) return workspaceEnv[envVar];

  const cfg = readConfigSync();
  return cfg.apiKeys[provider];
}

export function resolveBaseUrlSync(provider: string, workspace: string): string | undefined {
  const envVar = `${provider.toUpperCase()}_BASE_URL`;
  if (process.env[envVar]) return process.env[envVar]!;
  const cfg = readConfigSync();
  if (cfg.baseUrls[provider]) return cfg.baseUrls[provider];
  return PROVIDER_BASE_URLS[provider];
}