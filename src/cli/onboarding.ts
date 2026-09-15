import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolifyConfig } from "./run.js";
import { runAuthFlow, loadAuthSession, isAuthSessionValid } from "../auth/index.js";
import type { AuthProviderId } from "../auth/types.js";

export async function startOnboarding(workspace: string): Promise<ToolifyConfig> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log("");
  console.log("  TOOLIFY - your AI coding agent in the terminal");
  console.log("  Welcome! Sign in to get started.");
  console.log("");
  await ask("  Press Enter to begin...");

  // ---- Mandatory login: no skip path. Loops until a valid session exists. ----
  let session = loadAuthSession(workspace);
  while (!isAuthSessionValid(session)) {
    console.log("");
    console.log("  Sign in is required to use TOOLIFY.");
    console.log("  1. Sign in with Google");
    console.log("  2. Sign in with GitHub");
    const authChoice = await ask("  > ");
    const lc = authChoice.toLowerCase();
    const providerId: AuthProviderId =
      authChoice === "2" || lc.includes("hub") ? "github" : "google";
    try {
      session = await runAuthFlow(providerId, workspace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("");
      console.log("  Sign-in failed: " + msg);
      console.log("  Please try again - sign in is required to continue.");
    }
  }
  const who = session!.user.email ?? session!.user.accountName ?? session!.user.name;
  console.log("  Signed in as " + session!.user.name + (who !== session!.user.name ? " (" + who + ")" : "") + ".");

  console.log("");
  console.log("  Which LLM provider do you want to use?");
  console.log("  1. OpenAI - GPT-4o, GPT-4, GPT-3.5 Turbo");
  console.log("  2. Anthropic - Claude models");
  console.log("  3. Mock (offline) - scripted responses, no API key needed");
  console.log("  4. Ollama - run models locally");
  console.log("  5. Google Gemini - Gemini Pro, Flash, 2.0");
  const pChoice = await ask("  > ");
  const lc = pChoice.toLowerCase();
  const provider: ToolifyConfig["provider"] =
    pChoice === "2" || lc.startsWith("a") ? "anthropic"
    : pChoice === "3" || lc.startsWith("m") ? "mock"
    : pChoice === "4" || lc.startsWith("o") ? "ollama"
    : pChoice === "5" || lc.startsWith("g") ? "gemini"
    : "openai";

  const defaults: Record<string, string> =
    provider === "anthropic"
      ? { "1": "claude-3-5-sonnet-20241022", "2": "claude-3-opus-20240229", "3": "claude-sonnet-4-20250514" }
      : provider === "ollama"
      ? { "1": "llama3.1", "2": "codellama", "3": "mistral" }
      : provider === "gemini"
      ? { "1": "gemini-2.0-flash", "2": "gemini-1.5-pro", "3": "gemini-pro" }
      : provider === "mock"
      ? { "1": "mock-scripted" }
      : { "1": "gpt-4o", "2": "gpt-4o-mini", "3": "gpt-3.5-turbo" };

  console.log("");
  console.log("  Which model do you want to use?");
  for (const k of Object.keys(defaults)) console.log("  " + k + ". " + defaults[k]);
  const mChoice = await ask("  Type a model name or a number > ");
  const model = defaults[mChoice] !== undefined ? defaults[mChoice]! : (mChoice || defaults["1"]!);

  const finalCfg: ToolifyConfig = { provider, model };
  if (provider === "ollama") {
    const baseUrl = await ask("  baseUrl [http://localhost:11434/v1] > ");
    if (baseUrl) finalCfg.baseUrl = baseUrl;
  }

  console.log("");
  console.log("  Provider: " + finalCfg.provider + (finalCfg.baseUrl ? " (" + finalCfg.baseUrl + ")" : ""));
  console.log("  Model:    " + finalCfg.model);
  await ask("  Press Enter to start...");

  const dir = resolve(workspace, ".toolify");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "config.json"), JSON.stringify(finalCfg, null, 2) + "\n", "utf8");
  console.log("  Saved .toolify/config.json. Starting your session...");
  rl.close();
  return finalCfg;
}
