#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import type { ModelAdapter, ModelPricing } from "../agent/types.js";
import { OpenAICompatibleAdapter } from "../models/openai-compatible.js";
import { AnthropicAdapter } from "../models/anthropic.js";
import { MockModelAdapter } from "../models/mock.js";
import { PathGuard } from "../tools/fs-tools.js";
import { PolicyEngine, type ProjectPolicyConfig, TOOL_SCHEMAS } from "../tools/registry.js";
import { TaskDigest } from "../agent/digest.js";
import { ContextManager } from "../agent/context.js";
import { CostMeter } from "../agent/meter.js";
import { LoopDetector } from "../agent/loop-detector.js";
import { AgentLoop, type ApprovalHandler } from "../agent/loop.js";
import { SessionStore } from "../storage/session.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { VerificationGate } from "../verify/gate.js";
import { startChat } from "./chat.js";
import { startEntryFlow } from "./entry-new.js";
import { loadAuthSession, isAuthSessionValid, runAuthFlow, logout } from "../auth/index.js";
import { authPath } from "../auth/session.js";
import type { AuthProviderId } from "../auth/types.js";


export interface ToolifyConfig {
  provider: "openai" | "deepseek" | "anthropic" | "openrouter" | "omniroute" | "unoroute" | "ollama" | "litellm" | "gemini" | "mock";
  baseUrl?: string;
  apiKey?: string;
  model: string;
  pricing?: ModelPricing;
  policy?: ProjectPolicyConfig;
  verification?: { commands: Array<{ name: string; command: string }>; maxRounds?: number };
  maxIterations?: number;
  contextWindow?: number;
}

export async function loadConfig(workspace: string): Promise<ToolifyConfig> {
  try {
    const raw = (await readFile(resolve(workspace, ".toolify/config.json"), "utf8")).toString();
    return JSON.parse(raw) as ToolifyConfig;
  } catch {
    throw new Error(
      "No .toolify/config.json found in workspace. Create one with provider/model settings.",
    );
  }
}

export function createAdapter(cfg: ToolifyConfig): ModelAdapter {
  if (cfg.provider === "anthropic") {
    const apiKey = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("anthropic provider requires an API key (config or ANTHROPIC_API_KEY)");
    }
    return new AnthropicAdapter({ apiKey, model: cfg.model, pricing: cfg.pricing });
  }
  if (cfg.provider === "mock") {
    return new MockModelAdapter([
      { text: "Mock turn: hello from the scripted adapter!", finishReason: "stop" as const },
    ]);
  }
  const baseUrl = cfg.baseUrl ?? process.env.OPENAI_BASE_URL ?? "http://localhost:11434/v1";
  const apiKey = cfg.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  return new OpenAICompatibleAdapter({ baseUrl, apiKey, model: cfg.model, pricing: cfg.pricing });
}

export function isConfigComplete(cfg: Partial<ToolifyConfig> | null | undefined): cfg is ToolifyConfig {
  return !!cfg && typeof cfg.provider === "string" && typeof cfg.model === "string" && cfg.model.length > 0;
}

/** Try to load config; returns null instead of throwing when missing. */
export async function tryLoadConfig(workspace: string): Promise<ToolifyConfig | null> {
  try {
    return await loadConfig(workspace);
  } catch {
    return null;
  }
}

/** Persist a config to .toolify/config.json in the workspace. */
export async function saveConfig(workspace: string, cfg: ToolifyConfig): Promise<void> {
  await mkdir(resolve(workspace, ".toolify"), { recursive: true });
  await writeFile(resolve(workspace, ".toolify/config.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/**
 * Entry gate: requires BOTH a valid global auth session (mandatory login,
 * stored at ~/.toolify/auth.json) and a complete per-project config.
 * Launches the full-screen Ink entry flow (splash or wizard) when needed.
 * Returns null when the user cancels the wizard.
 */
export async function ensureConfig(workspace: string): Promise<ToolifyConfig | null> {
  const session = loadAuthSession(workspace);
  const existing = await tryLoadConfig(workspace);
  if (isAuthSessionValid(session) && isConfigComplete(existing)) {
    const flowed = await startEntryFlow(workspace, existing);
    return flowed?.config ?? null;
  }
  const flowed = await startEntryFlow(workspace, isConfigComplete(existing) ? existing : null);
  return flowed?.config ?? null;
}

/** Print who is currently signed in (global session). */
function printWhoami(workspace: string): void {
  const session = loadAuthSession(workspace);
  if (!isAuthSessionValid(session)) {
    console.log(`Not signed in. Run "toolify login" to sign in.`);
    process.exitCode = 1;
    return;
  }
  const who = session.user.email ?? session.user.accountName ?? session.user.id;
  console.log(`Signed in with ${session.user.provider} as ${session.user.name} (${who}).`);
  console.log(`Session: ${authPath(workspace)}`);
}

/** Non-interactive approval: deny gated actions unless auto-approve is set. */
export function makeApproval(autoApprove: boolean): ApprovalHandler {
  if (autoApprove) {
    return {
      request: async () => ({ approved: true, scope: "session" }),
    };
  }
  return {
    request: async (_call, _reason) => ({ approved: false }),
  };
}


function printEventHuman(e: unknown): void {
  const ev = e as { type: string; [k: string]: unknown };
  switch (ev.type) {
    case "assistant_message":
      console.log(`\nTOOLIFY: ${ev.content}`);
      break;
    case "tool_started": {
      const call = ev.call as {
        name: string;
        input: { command?: string; path?: string; pattern?: string };
      };
      const target = call.input?.command ?? call.input?.path ?? call.input?.pattern ?? "";
      console.log(`  [${call.name}] ${String(target).slice(0, 120)}`);
      break;
    }
    case "verification":
      console.log(`  [verify: ${ev.command}] ${ev.passed ? "PASSED" : "FAILED"}`);
      break;
    case "error":
      console.error(`  [error] ${ev.message}`);
      break;
    default:
      break;
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("toolify")
    .description("TOOLIFY — AI coding agent in your terminal (CLI-first)")
    .version("0.1.0");

  // Default command: bare `toolify` (or `toolify chat`) opens the interface.
  const addChatCommand = (name: string, description: string): void => {
    program
      .command(name, { isDefault: name === "chat" })
      .description(description)
      .option("--workspace <dir>", "Workspace directory", process.cwd())
      .action(async (opts) => {
        const workspace = resolve(opts.workspace);
        const cfg = await ensureConfig(workspace);
        if (cfg === null) {
          console.log(`Setup cancelled. Run "toolify chat" to try again.`);
          return;
        }
        await startChat(workspace, cfg);
      });
  };
  addChatCommand("chat", "Open the interactive TOOLIFY interface (default)");

  program
    .command("login")
    .description("Sign in with Google or GitHub (global, stored at ~/.toolify/auth.json)")
    .option("--provider <name>", "google or github", "google")
    .option("--workspace <dir>", "Workspace directory (only used for legacy session migration)", process.cwd())
    .action(async (opts) => {
      const workspace = resolve(opts.workspace);
      const raw = String(opts.provider ?? "google").toLowerCase();
      const providerId: AuthProviderId = raw.includes("hub") ? "github" : "google";
      const existing = loadAuthSession(workspace);
      if (isAuthSessionValid(existing)) {
        const who = existing.user.email ?? existing.user.accountName ?? existing.user.name;
        console.log(`Already signed in as ${existing.user.name} (${who}). Run "toolify logout" first to switch accounts.`);
        return;
      }
      const session = await runAuthFlow(providerId, workspace);
      const who = session.user.email ?? session.user.accountName ?? session.user.name;
      console.log(`Signed in as ${session.user.name} (${who}). Session: ${authPath(workspace)}`);
    });

  program
    .command("logout")
    .description("Sign out (removes the global session at ~/.toolify/auth.json)")
    .action(() => {
      if (logout()) {
        console.log(`Signed out. Global session removed.`);
      } else {
        console.log(`Not signed in - nothing to remove.`);
      }
    });

  program
    .command("whoami")
    .description("Show who is currently signed in")
    .option("--workspace <dir>", "Workspace directory (only used for legacy session migration)", process.cwd())
    .action((opts) => {
      printWhoami(resolve(opts.workspace));
    });

  program
    .command("run")
    .description("Run the agent headlessly on a goal (--json for JSONL events)")
    .argument("<goal>", "What the agent should do")
    .option("--workspace <dir>", "Workspace directory", process.cwd())
    .option("--auto-approve", "Auto-approve gated actions with per-session grants", false)
    .option("--json", "Emit machine-readable JSONL events", false)
    .option("--max-iterations <n>", "Max model iterations", parseInt)
    .action(async (goal: string, opts) => {
      const workspace = resolve(opts.workspace);
      const cfg = await loadConfig(workspace);
      const adapter = createAdapter(cfg);
      const guard = new PathGuard(workspace);
      const policy = new PolicyEngine(cfg.policy ?? {});
      const digest = new TaskDigest(goal);
      const context = new ContextManager(adapter, digest, { contextWindow: cfg.contextWindow });
      const meter = new CostMeter(adapter.pricing);
      const sessions = new SessionStore(workspace, SessionStore.newId());
      const checkpoints = new CheckpointStore(workspace);
      const approval = makeApproval(opts.autoApprove === true);
      const loopDetector = new LoopDetector();
      await sessions.init();
      await checkpoints.init();

      const emitAgentEvent = (e: unknown) => {
        if (opts.json) console.log(JSON.stringify(e));
        else printEventHuman(e);
      };

      const verification = new VerificationGate(guard, emitAgentEvent as never, {
        commands: cfg.verification?.commands ?? [],
        maxRounds: cfg.verification?.maxRounds ?? 3,
      });

            const loop = new AgentLoop({
        adapter,
        guard,
        policy,
        digest,
        context,
        meter,
        sessions,
        checkpoints,
        verification,
        approval,
        loopDetector,
        tools: TOOL_SCHEMAS,
        maxIterations: opts.maxIterations ?? cfg.maxIterations ?? 40,
        mode: "act",
      });

      const result = await loop.run(goal);
      if (opts.json) {
        console.log(JSON.stringify({ type: "run_result", ...result, costUsd: meter.costUsd }));
      } else {
        console.log(
          `\n[TOOLIFY finished: ${result.finishReason} | iterations: ${result.iterations} | verification rounds: ${result.verificationRounds} | cost: $${meter.costUsd.toFixed(4)}]`,
        );
        console.log(`[session log: ${sessions.sessionDir}\\events.jsonl]`);
      }
      process.exitCode = result.finishReason === "stop" ? 0 : 1;
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      console.error(`toolify: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
