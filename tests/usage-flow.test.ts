import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapter, type ToolifyConfig } from "../src/cli/run.js";
import { AgentLoop, type ApprovalHandler } from "../src/agent/loop.js";
import { PolicyEngine, TOOL_SCHEMAS } from "../src/tools/registry.js";
import { TaskDigest } from "../src/agent/digest.js";
import { ContextManager } from "../src/agent/context.js";
import { CostMeter } from "../src/agent/meter.js";
import { LoopDetector } from "../src/agent/loop-detector.js";
import { SessionStore } from "../src/storage/session.js";
import { CheckpointStore } from "../src/checkpoint/store.js";
import { VerificationGate } from "../src/verify/gate.js";
import { PathGuard } from "../src/tools/fs-tools.js";

/**
 * Runtime proof that token usage FLOWS — not hardcoded:
 *
 *   local OpenAI-protocol HTTP server (usage: 1234 in / 567 out)
 *     -> TOOLIFY createAdapter (key + base URL resolved from the real
 *        ~/.toolify/config.json credential store via a redirected HOME)
 *     -> AgentLoop
 *     -> CostMeter.add() -> usage_update events
 *     -> exactly the numbers the ChatUI status bar / /usage render.
 */

const EXPECTED_INPUT = 1234;
const EXPECTED_OUTPUT = 567;
const FIXTURE_KEY = "sk-fixture-live-key";

let server: http.Server;
let baseUrl = "";
let fixtureHome = "";
const authHeaders: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    authHeaders.push(auth);
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `unexpected path ${req.url}` } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-proof",
          choices: [{ finish_reason: "stop", message: { content: "ok from live server" } }],
          usage: { prompt_tokens: EXPECTED_INPUT, completion_tokens: EXPECTED_OUTPUT },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/v1`;

  // Redirect the credential store to a fixture home so the test exercises the
  // real ~/.toolify/config.json resolution path deterministically.
  fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "toolify-home-"));
  process.env.USERPROFILE = fixtureHome;
  process.env.HOME = fixtureHome;
  for (const k of [
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "GEMINI_API_KEY", "GEMINI_BASE_URL",
    "GROQ_API_KEY", "GROQ_BASE_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL",
  ]) delete process.env[k];
  const dir = path.join(fixtureHome, ".toolify");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ apiKeys: { openai: FIXTURE_KEY }, baseUrls: { openai: baseUrl } }),
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (fixtureHome) {
    fs.rmSync(fixtureHome, { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
  }
});

describe("token usage flows end-to-end (live HTTP -> agent loop -> meter)", () => {
  it("builds the adapter from ~/.toolify/config.json and returns the provider's real usage", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "toolify-usage-"));
    const cfg: ToolifyConfig = { provider: "openai", model: "gpt-4o" };
    const adapter = createAdapter(cfg, workspace);

    expect(adapter.baseUrl).toBe(baseUrl); // resolved from the fixture store

    const res = await adapter.chat({
      system: "test",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });

    expect(res.usage).toEqual({ inputTokens: EXPECTED_INPUT, outputTokens: EXPECTED_OUTPUT });
    // The saved (verified) key was attached to the live request.
    expect(authHeaders).toContain(`Bearer ${FIXTURE_KEY}`);
  });

  it("drives the full AgentLoop and emits usage_update with the same numbers", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "toolify-usage-loop-"));
    const adapter = createAdapter({ provider: "openai", model: "gpt-4o" }, workspace);
    const guard = new PathGuard(workspace);
    const policy = new PolicyEngine({});
    const digest = new TaskDigest("initial");
    const context = new ContextManager(adapter, digest, { contextWindow: 200_000 });
    const meter = new CostMeter(adapter.pricing);
    const sessions = new SessionStore(workspace, SessionStore.newId());
    const checkpoints = new CheckpointStore(workspace);
    const approval: ApprovalHandler = { request: async () => ({ approved: true, scope: "session" }) };
    const loop = new AgentLoop({
      adapter,
      guard,
      policy,
      digest,
      context,
      meter,
      sessions,
      checkpoints,
      verification: new VerificationGate(guard, () => {}, { commands: [], maxRounds: 2 }),
      approval,
      loopDetector: new LoopDetector(),
      tools: TOOL_SCHEMAS,
      maxIterations: 10,
      mode: "act",
    });

    const result = await loop.run("say hi");

    expect(result.finishReason).toBe("stop");
    expect(meter.usage.inputTokens).toBe(EXPECTED_INPUT);
    expect(meter.usage.outputTokens).toBe(EXPECTED_OUTPUT);

    const events = await sessions.readAll();
    const usageEvents = events.filter((e) => e.type === "usage_update");
    expect(usageEvents.length).toBeGreaterThan(0);
    const last = usageEvents[usageEvents.length - 1]!;
    expect(last.usage).toEqual({ inputTokens: EXPECTED_INPUT, outputTokens: EXPECTED_OUTPUT });
  });
});

