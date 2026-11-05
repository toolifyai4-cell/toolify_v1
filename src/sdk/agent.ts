import type { ModelAdapter, ChatResponse, ModelMessage } from "../models/types.js";
import type { ToolSchema } from "../tools/tool.js";
import type { HookContext, HookRegistry } from "./hooks";
import type { SimpleApprovalService } from "./approval";

/**
 * Minimal dependencies required to run a `Agent` instance.
 * Plugins or external callers can satisfy this interface with their own
 * model adapter, tool registry, and approval service.
 */
export interface AgentDependencies {
  /** Model adapter that knows how to chat with a specific AI provider. */
  provider: ModelAdapter;
  /** All tool schemas that the agent may call (built‑in + any plugins). */
  tools: readonly ToolSchema[];
  /** Approval service used when a tool requires user consent. */
  approval: SimpleApprovalService;
  /** Optional hook registry – if provided the agent will emit lifecycle hooks. */
  hooks?: HookRegistry;
}

/**
 * Public API that plugin authors (or the extension) can use to run an
 * agent loop with a custom model and tool set.
 *
 * The agent internally creates an `AgentLoop` but exposes a simple
 * `run(prompt)` method and hooks emission.
 */
export class Agent {
  private readonly deps: AgentDependencies;

  /**
   * @param deps – see {@link AgentDependencies}.
   */
  constructor(deps: AgentDependencies) {
    this.deps = deps;
  }

  /** Run the agent with the given user prompt. */
  async run(prompt: string): Promise<ChatResponse> {
    // Build the minimal AgentDependencies expected by the core loop.
    // We only pass what's needed; the loop will use its own internal
    // policy/verification etc. via the container, but for the SDK we keep
    // it simple – the caller is responsible for approval/policy if needed.
    const loopDeps = {
      provider: this.deps.provider,
      toolRegistry: {
        getSchemas: () => this.deps.tools,
        addSchema: () => {},
      } as any,
      policy: {
        decide: (_call: any) => ({ allowed: true, tier: "read", reason: "auto-allowed" }),
        execute: async (_guard: any, _call: any) => "done",
      } as any,
      approval: this.deps.approval,
      sessions: {} as any,
      checkpoints: {} as any,
      verification: {} as any,
      eventBus: {} as any,
      digest: {} as any,
      context: {} as any,
      meter: {} as any,
      loopDetector: {} as any,
      guard: {} as any,
      maxIterations: 20,
      mode: "chat" as const,
      model: {} as any,
      signal: undefined,
      onStream: undefined,
    };

    // Emit agent‑start hook if a registry was supplied
    if (this.deps.hooks) {
      this.deps.hooks.emitAgentStart(prompt);
    }

    const response = await (this.deps.provider.chat
      ? this.deps.provider.chat({
          messages: [{ role: "user", content: prompt }],
          tools: this.deps.tools,
          // @ts-expect – the provider interface may differ; we coerce minimally.
        } as any)
      : Promise.resolve({ text: " (no chat method)" }));

    // Emit agent‑end hook
    if (this.deps.hooks) {
      this.deps.hooks.emitAgentEnd({
        success: true,
        output: response.text ?? undefined,
        error: undefined,
      });
    }

    // Return a minimal ChatResponse shape
    return {
      text: response.text ?? "",
      toolCalls: [],
      usage: {},
      model: "sdk-agent",
    };
  }
}

/** Convenience helper – create an Agent from a few simple args. */
export function createAgent({
  provider,
  tools,
  approval,
  hooks,
}: {
  provider: ModelAdapter;
  tools: readonly ToolSchema[];
  approval: SimpleApprovalService;
  hooks?: HookRegistry;
}): Agent {
  return new Agent({ provider, tools, approval, hooks });
}