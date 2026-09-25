# TOOLIFY — Architecture

## Overview

TOOLIFY is a terminal-first AI coding agent. It runs an agent loop: system
prompt → LLM → tool calls → policy check → approval → execute → checkpoint →
compaction → repeat → verification gate → finish.

This document describes the architecture as of **Phase 1**, which introduced
stable provider, tool, approval, persistence, event, and runtime interfaces
while preserving all existing TOOLIFY behavior.

## High-level data flow

```
  CLI (run / chat)
       │
       ▼
  createAgentContainer(opts)        ← src/app/container.ts
       │  ── constructs all runtime deps ──
       │  ── wraps concrete impls in new contract interfaces ──
       ▼
  createAgentLoop(deps)             ← src/agent/loop.ts
       │  ── bridges AgentDependencies → AgentLoopOptions ──
       ▼
  AgentLoop.run(goal)
       │
       ├──► ModelProvider.chat()         ← src/providers/provider.ts
       ├──► ToolRegistry.execute()        ← src/tools/tool.ts
       │      └──► ApprovalService.request() ← src/safety/approval-service.ts
       ├──► CheckpointRepository.take()  ← src/persistence/checkpoint-repository.ts
       ├──► SessionRepository.append()   ← src/persistence/session-repository.ts
       ├──► VerificationService.run()    ← src/verify/gate.ts
       └──► EventBus.emit()              ← src/agent/events.ts
```

## Layer map

| Layer | Key files | Responsibility |
|-------|-----------|----------------|
| CLI | `src/cli/run.ts`, `src/cli/chat.tsx` | Headless and interactive entry points |
| App | `src/app/container.ts`, `src/app/runtime-context.ts` | Dependency injection container + `AgentDependencies` type |
| Agent | `src/agent/loop.ts`, `src/agent/gate.ts`, `src/agent/events.ts` | Agent loop, verification gate interface, event bus |
| Provider | `src/providers/provider.ts` | Model-agnostic LLM interface (`ModelProvider`) |
| Tools | `src/tools/tool.ts`, `src/tools/tool-registry-adapter.ts` | Tool definition interface + adapter wrapping existing `PolicyEngine`+`PathGuard` |
| Safety | `src/safety/approval-service.ts` | `ApprovalService` interface + `LegacyApprovalHandler` adapter |
| Persistence | `src/persistence/session-repository.ts`, `src/persistence/checkpoint-repository.ts` | Repository interfaces for session log + content-addressed checkpoints |
| Storage (impl) | `src/storage/session.ts`, `src/checkpoint/store.ts` | Concrete `SessionStore` and `CheckpointStore` |

## Phase 1 boundary decisions

### What changed

- **New interface modules** created in `src/providers/`, `src/tools/`,
  `src/safety/`, `src/persistence/`, `src/app/`, and `src/agent/` — each
  defines a stable contract.
- **`createAgentContainer`** factory wires concrete implementations into
  these interfaces in one place.
- **`createAgentLoop`** factory bridges `AgentDependencies` back to
  `AgentLoopOptions` via an approval-handler adapter, so the existing loop
  internals are untouched.
- **CLI updated** (`run.ts`, `chat.tsx`) to use the container + factory.
- **Event bus** added (`InMemoryEventBus`) so multiple subscribers can listen
  to agent events in parallel.

### What stayed the same

- `AgentLoop`, `PolicyEngine`, `PathGuard`, `VerificationGate`,
  `SessionStore`, `CheckpointStore`, `CostMeter`, `ContextManager`,
  `TaskDigest`, and `LoopDetector` classes are unchanged in behavior.
- Tool schemas and policy decisions are identical.
- All existing tests pass without modification.

## Container wiring

`createAgentContainer` accepts a `ContainerOptions` object and returns an
`AgentDependencies` that contains:

1. **Interface views** — `provider`, `toolRegistry`, `approval`
   (as `ApprovalService`), `sessionRepo`, `checkpointRepo`, `verification`,
   `eventBus`.
2. **Concrete implementations** — `adapter`, `guard`, `policy`, `digest`,
   `context`, `meter`, `loopDetector`, `sessions`, `checkpoints`,
   `verificationGate`, `toolSchemas`.
3. **Configuration** — `mode`, `maxIterations`, `modelTimeoutMs`, `signal`,
   `onStream`.

The container **never** imports React, Ink, or CLI-specific code.

## Event bus

`InMemoryEventBus` (in `src/agent/events.ts`) allows multiple subscribers:

- **Error isolation**: listener errors are collected and re-thrown as an
  `AggregateError` after all subscribers have been notified.
- **Synchronous dispatch**: events are emitted synchronously during the loop.

## Approval flow

```
AgentLoop.executeTool()
  → policy.decide(call)
  → if denied: ApprovalService.request(call, context)
  → if approved: grantForSession or grantOnce, then execute
```

The container accepts a `LegacyApprovalHandler` and wraps it as an
`ApprovalService` internally, providing backward compatibility.

## Verification gate

The `VerificationGate` implements the `VerificationService` interface. It
runs configured shell commands after the agent believes it has completed a
task. Supports multiple rounds with feedback injection.

## Persistence model

- **SessionStore** (`src/storage/session.ts`): append-only JSONL event log
  per session at `.toolify/sessions/<id>/events.jsonl`. Malformed entries
  are skipped safely during read.
- **CheckpointStore** (`src/checkpoint/store.ts`): content-addressed
  snapshots using SHA-256 hashes in `.toolify/objects/`.

## Testing strategy

- Interface-level tests: `provider.test.ts`, `tool-registry.test.ts`,
  `approval-service.test.ts`, etc.
- Integration test: `agent-loop-integration.test.ts` exercises the full
  container + loop pipeline.
- Pre-existing tests remain unchanged.
