# Known Limitations

## Phase 2 — Current constraints and future work

### 0. Streaming caveats

Streaming is implemented for all providers the CLI wires up, but with real
caveats worth knowing:

- **Not every "OpenAI-compatible" endpoint honours `stream: true`.** Some
  gateways and proxies reply with a single JSON completion. The adapter detects
  this by `content-type` and falls back to the non-streaming parse, but those
  turns will not stream incrementally.
- **Token usage may be missing mid-stream.** With `stream_options:
  { include_usage: true }` usage arrives in a trailing chunk; providers that do
  not implement that field return no usage, so the cost meter shows 0 for those
  turns. The non-streaming path is unaffected.
- **No retry or resume mid-stream.** If a stream drops after partial output, the
  whole turn fails. There is no automatic re-request, because replaying a
  partially-delivered tool call could duplicate side effects.
- **`reasoning_delta` is surfaced but not rendered.** DeepSeek-style
  `reasoning_content` and Anthropic `thinking` blocks are parsed and emitted as
  events, but the TUI does not yet display them.
- **Mid-stream cancellations are not retried**, only surfaced as an abort.

### 1. Approval service scope mapping is lossy

*Partially resolved in Phase 1.* The loop now consumes `ApprovalService`
directly, so the round-trip through `ApprovalHandler` only happens on the
legacy `resolveDeps()` compatibility path. One lossy mapping remains there:
`"workspace"` scope is downgraded to `"session"` when bridging a legacy
`ApprovalHandler` (whose type only allows `"once" | "session"`).

**Future**: drop the legacy bridge once no caller constructs
`new AgentLoop({ approval: ApprovalHandler })` directly.

### 2. Container creates concrete implementations per-call

`createAgentContainer` constructs `SessionStore`, `CheckpointStore`,
`CostMeter`, `LoopDetector`, `ContextManager`, and `TaskDigest` fresh on
every invocation. In the chat TUI, the meter is synced back into a
persistent ref after each turn, but the other impls are recreated per
message. This is correct for `digest`/`context` (state is per-turn) but
means `LoopDetector` diversity tracking resets between turns.

**Future**: Phase 2 may introduce container-level lifecycle management
(e.g. `ContainerScope`) that reuses long-lived services across turns.

### 3. Event bus is synchronous and in-memory

`InMemoryEventBus` emits events synchronously. If any subscriber is slow
(or throws), it blocks the loop. The aggregate-error re-throw prevents a
single failing listener from silently killing subsequent listeners, but
there is no backpressure or queueing mechanism.

**Future**: Consider an async event bus with buffering for telemetry
subscribers that perform I/O.

### 4. Tool registry adapter wraps PolicyEngine.executeTool

`ToolRegistryAdapter.execute()` delegates to `PolicyEngine.executeTool()`,
which is a large switch statement over tool names. This is preserved from
the original codebase. The new `ToolDefinition` interface exposes `tier`
(risk level) from the policy engine, but tool execution still flows through
the same code path.

**Future**: Phase 2 may refactor tools into independently registered
plugins that implement `ToolDefinition` directly.

### 5. `run.ts` onStream callbacks are JSON-only

The headless `toolify run --json` command emits JSONL stream events
(`assistant_delta`, `tool_start`, `tool_result`, `error`, `status`).
Non-JSON mode does not display live streaming — it only shows the final
summary line. The chat TUI has the rich streaming UI.

**Future**: Consider adding a `--stream` flag for live terminal output in
headless mode.

### 6. ~~`createAgentLoop` adapts ApprovalService → ApprovalHandler~~ (resolved)

*Resolved in Phase 1.* The loop now consumes `ApprovalService` directly through
`AgentRuntimeDeps`, and the approval request passes the real `riskTier` from the
policy decision:

```ts
await o.approval.request(call, {
  riskTier: decision.tier,
  reason: decision.reason,
  workspace: o.guard.root,
});
```

`createAgentLoop` is now a pure pass-through. The legacy `ApprovalHandler` is
only bridged inside `resolveDeps()`, which exists solely for backward
compatibility with older `new AgentLoop({...})` call sites (the existing tests).

### 7. SessionStore.readAll() loads entire log into memory

`SessionStore.read()` reads the entire `events.jsonl` file into memory
and parses every line. For very long sessions (>10 000 events), this
becomes slow and memory-intensive.

**Future**: Add a cursor-based streaming or paginated read API.

### 8. No transactional writes for checkpoints

`CheckpointStore.snapshot()` writes each file independently. There is no
atomic commit — a crash mid-snapshot can leave orphaned objects in
`.toolify/objects/`. The session log (`SessionStore.append()`) is
append-only and therefore crash-safe at the line level.

**Future**: Introduce a manifest file per checkpoint with a two-phase
commit (write manifest, then rename).

### 9. chat.tsx creates a new container per turn

The chat TUI calls `createAgentContainer` inside `onSubmit` for every
user message. While this is correct (each turn gets a fresh digest/context),
it also creates a new `SessionStore` with a `sessionId` derived from the
existing `sessionsRef`. The `CheckpointStore` is recreated fresh each turn,
which is fine since it's stateless beyond the filesystem.

### 10. `onEvent` callback is optional

When `onEvent` is not provided to the container, the `VerificationGate`
receives `undefined` for the event emitter callback. In this case,
verification events are still emitted to the `eventBus` but not to any
external callback. For headless `run.ts` without `--json`, no events are
printed.
