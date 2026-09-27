# Known Limitations

## Phase 2.1 — Bug fixes from the live smoke test

The live streaming smoke test surfaced four real defects. All are fixed; the
notes below record what to watch for going forward.

### 1. Tool-calling wire format (was: HTTP 400 on every tool turn)

`toWireMessages()` returns an **array**, and the request body must therefore use
`flatMap`, not `map(...spread)`. Using `map` nests an array inside `messages`,
which OpenAI-compatible endpoints reject with
`messages.N: expected object, received array`.

This broke **every** turn that fed a tool result back — i.e. every real coding
task. Only conversational turns (which use no tools) worked.

It escaped the test suite because every tool-loop test drives `MockModelAdapter`,
which never serializes to the wire, and the one HTTP-level fixture
(`usage-flow`) never returns tool calls. `tests/wire-format.test.ts` now asserts
the serialized body is structurally flat.

**Watch for:** any new provider adapter that builds a `messages` array by hand.

### 2. Usage was synced before the run

`chat.tsx` copied `deps.meter.usage` into the persistent meter *before*
`loop.run()`. Because the container builds a fresh `CostMeter` per turn, that
always copied `{0, 0}` — so the status bar and `/usage` reported 0 while the
session log recorded real usage. The sync now happens in `finally`, after the run.

**Watch for:** any other consumer of `deps.meter` that reads it outside the run.

### 3. Orphaned thinking placeholders

`onFirstToken` was declared in `StreamCallbacks` but never wired in `chat.tsx`,
and the cleanup only inspected the *last* message. Any turn that produced no
assistant text (tool-only, error, or abort) stranded a permanent `...` in the
transcript, and they accumulated across turns.

Now `onFirstToken` clears the placeholder, and the `finally` cleanup removes
**any** empty `thinking` message rather than only a trailing one.

**Watch for:** new renderers that display a pending state without a guaranteed
teardown path.

### 4. Glob received literal quotes from the model

Weaker models emit patterns like `"**/*.java"` where the quotes are part of the
string value. `normalizePattern()` now strips symmetric wrapping quotes (and
whitespace) before matching. Only symmetric wraps are removed, so a pattern with
an internal quote is untouched.

### 5. Pricing: unknown models read as free

Unknown models previously resolved to `{inputPerM: 0, outputPerM: 0}`, so `/usage`
showed `$0.0000` — indistinguishable from a genuinely free model. `src/models/pricing.ts`
now returns an explicit `UNKNOWN_PRICING` marker, `CostMeter.pricingUnknown`
exposes it, and `/usage` prints "Cost: unknown" instead of a misleading zero.

Setting a `pricing` block in `.toolify/config.json` still overrides everything.

### 6. `stream_options` is an OpenAI-ism some providers reject

Streaming requests send `stream_options: { include_usage: true }` to get token
accounting in the final chunk. Z.AI/GLM strictly validates the request body and
documents only six parameters (`max_tokens`, `temperature`, `top_p`, `do_sample`,
`thinking.type`, `response_format.type`) — it rejects the unknown field with a
generic `Invalid API parameter` (code 1210).

Rather than hardcoding a vendor exception, the adapter **probes optimistically**:
on a 400 while the field is in play it withdraws it, retries once, and remembers
the result for the rest of the session (emitting one warning). The turn then
succeeds with **usage data absent** — a soft degradation instead of a hard
failure.

Consequences for such providers:
- Streaming turns report `inputTokens: 0` / `outputTokens: 0`.
- The cost meter under-reports for those turns.

`streamUsage: false` can be passed to the adapter to opt out up front and skip
the probe round-trip entirely.

**Caveat:** the 400 does not name the offending field, so this is a
guess-and-fallback rather than a precise diagnosis. If a provider rejects a
*different* unknown field, the same fallback will trigger, and the error message
notes that the retry already happened.

**Watch for:** other strictly-validating gateways. The fallback is generic, so
they are covered automatically, but each will lose stream-mode usage.

---

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
