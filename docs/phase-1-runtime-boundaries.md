# Phase 1 — Runtime Boundaries

This document describes the stable contract boundaries introduced in Phase 1
of the TOOLIFY runtime refactor.

## 1. Provider boundary

**Interface**: `ModelProvider` (`src/providers/provider.ts`)

```typescript
export interface ModelProvider {
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<ModelEvent>;
}

export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly reasoning?: boolean;
  readonly vision?: boolean;
}
```

- `stream()` is optional and **is implemented as of Phase 2**. `MockModelAdapter`
  deliberately omits it, so the deterministic end-to-end tests stay on the
  stable `chat()` path.
- `capabilities.streaming` is derived by `createModelProvider` from whether the
  wrapped adapter actually has a `stream()` method — it is not hard-coded.
- `ModelEvent` is defined canonically in `src/agent/types.ts` and re-exported
  here. The union is: `text_delta`, `reasoning_delta`, `tool_call_start`,
  `tool_call_delta`, `tool_call_complete`, `usage`, `completed`, `error`.
- The loop accepts either path and normalises both into a single
  `ChatResponse` via `consumeProviderStream` (`src/agent/stream-consumer.ts`).
- `AgentTimeoutError` is thrown on timeout; the loop classifies it into a
  user-friendly banner.

### Streaming coverage (Phase 2)

`stream()` is implemented in two adapters, which together cover every provider
the CLI wires up:

- `OpenAICompatibleAdapter.stream()` — OpenAI, OpenRouter, Groq, DeepSeek,
  Gemini (via Google's OpenAI-compatibility layer), Ollama, LM Studio, vLLM,
  LiteLLM, OmniRoute, UnoRoute. These all share the `/chat/completions` SSE
  vocabulary, so one implementation covers them all.
- `AnthropicAdapter.stream()` — the native Messages API, which uses typed
  events (`message_start`, `content_block_delta`, `message_delta`, ...).

Both rely on the shared primitives in `src/providers/streaming.ts`:

- `iterSse()` — a correct SSE reader (chunk-boundary reassembly, `:` keep-alive
  comments, `event:` names, multi-line `data:`, `[DONE]` sentinel, abort).
- `ToolCallAccumulator` — reassembles tool-call arguments streamed as
  arbitrary JSON fragments.
- `parseToolArguments()` — flags truncated JSON instead of throwing.

**Non-SSE fallback:** some "OpenAI-compatible" gateways ignore `stream: true`
and return a single JSON completion. The adapter detects this via the response
`content-type` and falls back to the non-streaming parse, so those endpoints do
not silently produce an empty turn.

## 2. Tool boundary

**Interfaces**: `ToolRegistry`, `ToolDefinition`, `ToolExecutor`, `PolicyGate`
(`src/tools/tool.ts`)

```typescript
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly risk: RiskTier;
  readonly inputSchema: Record<string, unknown>;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

export interface ToolRegistry extends ToolExecutor {
  get(name: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
}

export interface PolicyGate {
  decide(call: ToolCall): PolicyDecision;
  grantForSession(tier: RiskTier): void;
}
```

- Note there is no `has()` method; use `get(name) !== undefined`.
- `PolicyGate` is deliberately separate from `ToolRegistry`: the registry
  *executes* tools, the gate *decides* whether a call is allowed and remembers
  session-wide grants. `PolicyEngine` satisfies both interfaces structurally.
- `ToolResult` is structured: `{ ok, content, data?, error? }` where `error` is
  `{ code, message, recoverable, details? }`.
- `ToolExecutionContext` carries `{ workspace, guard, signal?, policy?,
  approval?, eventBus?, maxOutputChars? }`, replacing the old positional
  `(guard, input)` signature.

- The container wraps the existing `PolicyEngine` + `PathGuard` via
  `createToolRegistryAdapter` (`src/tools/tool-registry-adapter.ts`).
- The loop calls `toolRegistry.execute()` which returns a structured result.

## 3. Approval boundary

**Interface**: `ApprovalService` (`src/safety/approval-service.ts`)

```typescript
export interface ApprovalService {
  request(call: ToolCall, ctx: ApprovalContext): Promise<ApprovalDecision>;
}
```

- The container wraps the existing `ApprovalHandler` (from `AgentLoopOptions`)
  via `createApprovalService`, which converts the old two-arg `request()` into
  the new `ApprovalContext`-based call.
- CLI (`run.ts`) passes a `LegacyApprovalHandler` from `makeApproval()`.
- Chat TUI (`chat.tsx`) passes an interactive `ApprovalHandler`.
- Default: deny-all (non-interactive use).

## 4. Persistence boundaries

### Session repository

**Interface**: `SessionRepository` (`src/persistence/session-repository.ts`)

```typescript
export interface SessionRepository {
  init(): Promise<void>;
  append(event: AgentEvent): Promise<void>;
  readAll(): Promise<AgentEvent[]>;
  loadState?(): Promise<SessionState | null>;
  saveState?(state: SessionState): Promise<void>;
}
```

- The method is `readAll()`, not `read()`.
- `loadState` / `saveState` are optional; `SessionStore` implements them via
  `.toolify/sessions/<id>/state.json`.
- Implemented by `SessionStore` (`src/storage/session.ts`).
- Safe malformed-entry handling: lines that fail `JSON.parse` are skipped.
- Events are written to `.toolify/sessions/<id>/events.jsonl`.

### Checkpoint repository

**Interface**: `CheckpointRepository` (`src/persistence/checkpoint-repository.ts`)

```typescript
export interface CheckpointRepository {
  init(): Promise<void>;
  snapshot(paths: string[]): Promise<Checkpoint>;
  list(): Promise<Checkpoint[]>;
  restore(id: string): Promise<string[]>;
}
```

- The parameter is a `string[]` of workspace-relative paths, not `TouchedFile[]`.
- Implemented by `CheckpointStore` (`src/checkpoint/store.ts`).
- Content-addressed: each file is stored under its SHA-256 hash in
  `.toolify/objects/`, with manifests in `.toolify/checkpoints/<id>.json`.

## 5. Event boundary

**Interface**: `AgentEventBus` (`src/agent/events.ts`)

```typescript
export interface AgentEventBus {
  emit(event: AgentEvent): Promise<void> | void;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
```

- There is no `unsubscribe(fn)` method; `subscribe()` *returns* the
  unsubscribe function.
- Implemented by `InMemoryEventBus`.
- Multiple subscribers receive every event, in registration order.
- A single throwing listener rethrows directly; multiple throws are combined
  into an `AggregateError`. Either way all listeners are notified first, and
  the last error is retained for `getLastError()` introspection.
- The container wires the event bus into `VerificationGate` and exposes it on
  `AgentDependencies.eventBus`.

## 6. Runtime boundary

**Interfaces**: `AgentDependencies` (`src/app/runtime-context.ts`) and
`AgentRuntimeDeps` (`src/agent/loop.ts`)

`AgentDependencies` is what the container produces and `createAgentLoop`
consumes. It carries both interface views and the underlying concrete
implementations, because some agent-core services (`digest`, `context`,
`meter`, `loopDetector`) are still concrete classes in Phase 1.

`AgentRuntimeDeps` is the strictly interface-only subset that the **loop body**
actually consumes. `AgentLoop` holds one of these, never the concrete set.

### Loop decoupling status

The loop no longer imports `PolicyEngine`, `SessionStore`, `CheckpointStore`,
`VerificationGate`, or `ModelAdapter` for its runtime behaviour:

| Concern | Loop used before | Loop uses now |
| --- | --- | --- |
| Model call | `adapter.chat()` | `provider.chat()` |
| Tool execution | `policy.execute(guard, call)` | `toolRegistry.execute(call, ctx)` |
| Policy check | `policy.decide(call)` | `policy.decide(call)` via `PolicyGate` |
| Approval | `approval.request(call, reason)` | `approval.request(call, ctx)` |
| Session write | `sessions.append(e)` | `sessions.append(e)` via `SessionRepository` |
| Checkpoint | `checkpoints.snapshot(paths)` | via `CheckpointRepository` |
| Verification | `verification.config.maxRounds` | `verification.maxRounds` via `VerificationService` |

### Backward compatibility

`AgentLoop`'s constructor accepts `AgentLoopOptions | AgentRuntimeDeps`. The
legacy concrete options are normalised by `resolveDeps()`, which is the single
place that bridges `PolicyEngine` -> `ToolRegistry`, `ApprovalHandler` ->
`ApprovalService`, and `ModelAdapter` -> `ModelProvider`.

This keeps `tests/agent-loop.e2e.test.ts`, `tests/plan-mode.test.ts`, and
`tests/usage-flow.test.ts` (which all use `new AgentLoop({ adapter, policy,
sessions, ... })`) working without modification. New code should use
`createAgentLoop(deps)`, which is now a pure pass-through with no adapters.

## Wiring summary

```
createAgentContainer(opts: ContainerOptions) -> AgentDependencies
  -> createAgentLoop(deps: AgentDependencies) -> AgentLoop
  -> AgentLoop.run(goal: string) -> AgentRunResult
```

The container owns construction. The loop factory is a pass-through. The loop
class owns execution. CLI and tests never touch internal implementation classes
directly - they go through `createAgentContainer` + `createAgentLoop`.

## Timeout semantics

The two model paths are bounded differently, and deliberately so:

| Path | Bound | Rationale |
| --- | --- | --- |
| `provider.chat()` | one wall-clock deadline for the whole call | The entire response must arrive within N ms. |
| `provider.stream()` | per-chunk idle deadline | A long generation is legitimate; a *silent* stream is a hang. |

`withTimeout` / `AgentTimeoutError` live in `src/agent/timeouts.ts` so the
stream consumer can raise the same error the loop's classifier already
understands, without importing `loop.ts` (which would be a cycle). They are
re-exported from `loop.ts` for backward compatibility.

`consumeProviderStream` derives a **local** `AbortController` from the caller's
signal, so cancelling the run tears down the HTTP connection without aborting
the caller's own controller.

## Validation

- `npx tsc --noEmit` - passes.
- `npm run build` - passes.
- `tests/streaming-primitives.test.ts` (18) - SSE reader + tool-call accumulator.
- `tests/provider-streaming.test.ts` (16) - both adapters, `fetch` stubbed with
  hand-built SSE bodies (no network, no API keys).
- `tests/loop-streaming.test.ts` (2) - loop prefers `stream()`, delivers deltas
  live, and does **not** re-send the assembled text; non-streaming providers
  still fall back to `chat()`.
- All Phase 1 contract tests still pass, including `agent-loop.e2e` and
  `usage-flow`.
- Pre-existing, unrelated failures remain in `tests/plan-mode.test.ts`,
  `tests/workspace-warning.test.ts`, `tests/activity.test.ts`,
  `tests/resolve-workspace.test.ts`, and `tests/provider-theme-smoke.test.ts`.
  These import symbols that do not exist at HEAD either (`PLAN_MODE_FOOTER`,
  `workspaceWarnings`, `resolveWorkspace`, `activityText`), and the failure count
  is identical (32) when the suite is run against commit `6b67d44`.
