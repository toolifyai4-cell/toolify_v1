import { MockModelAdapter } from "/TOOLIFY_V1/src/models/mock.js";
import { PathGuard } from "/TOOLIFY_V1/src/tools/fs-tools.js";
import { PolicyEngine } from "/TOOLIFY_V1/src/tools/registry.js";
import { TaskDigest } from "/TOOLIFY_V1/src/agent/digest.js";
import { ContextManager } from "/TOOLIFY_V1/src/agent/context.js";
import { CostMeter } from "/TOOLIFY_V1/src/agent/meter.js";
import { LoopDetector } from "/TOOLIFY_V1/src/agent/loop-detector.js";
import { AgentLoop } from "/TOOLIFY_V1/src/agent/loop.js";
import { SessionStore } from "/TOOLIFY_V1/src/storage/session.js";
import { CheckpointStore } from "/TOOLIFY_V1/src/checkpoint/store.js";
import { VerificationGate } from "/TOOLIFY_V1/src/verify/gate.js";
import { TOOL_SCHEMAS } from "/TOOLIFY_V1/src/tools/registry.js";

const workspace = "/TOOLIFY_V1/.tmp-smoke";
const guard = new PathGuard(workspace);
const adapter = new MockModelAdapter([
  {
    text: "I completed your task.",
    finishReason: "stop",
  },
]);
const policy = new PolicyEngine({});
const meter = new CostMeter(adapter.pricing);
const sessions = new SessionStore(workspace, SessionStore.newId());
const checkpoints = new CheckpointStore(workspace);
const digest = new TaskDigest("Write a README saying hello");
const context = new ContextManager(adapter, digest);
const verification = new VerificationGate(guard, () => {});
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
  approval: { request: async () => ({ approved: true, scope: "session" }) },
  loopDetector: new LoopDetector(),
  tools: TOOL_SCHEMAS,
  maxIterations: 5,
  mode: "act",
});

const result = await loop.run("Write a README saying hello");
console.log("LOOP-FINISH:" + result.finishReason);
console.log("LOOP-ITERATIONS:" + result.iterations);
console.log("LOOP-COST:$" + meter.costUsd.toFixed(4));
console.log("LOOP-INPUT_TOK:" + meter.usage.inputTokens);
console.log("LOOP-OUTPUT_TOK:" + meter.usage.outputTokens);
