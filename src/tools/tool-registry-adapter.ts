/**
 * Adapter that wraps the existing `PolicyEngine` (and `PathGuard`) as a
 * `ToolRegistry`, bridging the old `(guard, call)` execution model to the
 * new `ToolExecutionContext` contract.
 *
 * This avoids rewriting any existing tool implementation — it simply adapts
 * the call signature.
 */
import type { ToolCall, ToolSchema } from "../agent/types.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolError,
  ToolResult,
  ToolExecutor,
  ToolRegistry,
} from "./tool.js";
import type { PolicyEngine } from "./registry.js";
import type { PathGuard } from "./fs-tools.js";
import type { RiskTier } from "../agent/types.js";
import { TOOL_SCHEMAS, TIER_BY_TOOL } from "./registry.js";
import { PathGuard as PathGuardClass } from "./fs-tools.js";

// ---------------------------------------------------------------------------
// Convert a legacy ToolSchema into a ToolDefinition
// ---------------------------------------------------------------------------

/** Default output-size limit for tool results. */
const DEFAULT_MAX_OUTPUT_CHARS = 10_000;

/**
 * Build a `ToolDefinition` from an existing `ToolSchema` + `PolicyEngine`.
 * Each definition delegates `execute` to `policy.execute(guard, call)`.
 */
export function createToolDefinition(
  schema: ToolSchema,
  policy: PolicyEngine,
  guard: PathGuard,
): ToolDefinition {
  const risk: RiskTier =
    (TIER_BY_TOOL[schema.name as never] as RiskTier | undefined) ?? "dangerous";

  return {
    name: schema.name,
    description: schema.description,
    risk,
    inputSchema: schema.inputSchema,
    validate(input: unknown): unknown {
      return input;
    },
    async execute(input, ctx): Promise<ToolResult> {
      const call: ToolCall = {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: schema.name,
        input,
      };
      const localGuard = ctx.guard ?? guard;
      try {
        const r = await policy.execute(localGuard as PathGuard, call);
        const content = typeof r === "string" ? r : r.output;
        const isError = typeof r === "object" && "exitCode" in r && (r as { exitCode: number }).exitCode !== 0;
        const maxChars = ctx.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
        const truncated =
          content.length > maxChars
            ? content.slice(0, maxChars) + `\n[truncated, ${content.length} chars total]`
            : content;

        return isError
          ? {
              ok: false,
              content: truncated,
              error: {
                code: "TOOL_EXECUTION_FAILED",
                message: truncated,
                recoverable: true,
              } as ToolError,
            }
          : { ok: true, content: truncated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          content: msg,
          error: {
            code: "TOOL_EXECUTION_FAILED",
            message: msg,
            recoverable: true,
          } as ToolError,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Registry adapter
// ---------------------------------------------------------------------------

/**
 * A `ToolRegistry` backed by the existing `PolicyEngine` + `PathGuard`.
 *
 * - `get` / `list` return `ToolDefinition`s built from the existing schemas.
 * - `execute` delegates to `PolicyEngine.execute`.
 */
export class PolicyEngineToolRegistry implements ToolRegistry {
  private readonly definitions: ToolDefinition[];
  private readonly pathGuard: PathGuard;

  constructor(
    private readonly policy: PolicyEngine,
    guard: PathGuard,
  ) {
    this.pathGuard = guard;
    this.definitions = TOOL_SCHEMAS.map((s) =>
      createToolDefinition(s, this.policy, this.pathGuard),
    );
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.find((d) => d.name === name);
  }

  list(): readonly ToolDefinition[] {
    return this.definitions;
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const def = this.get(call.name as string);
    if (!def) {
      return {
        ok: false,
        content: `Unknown tool: ${call.name}`,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool: ${call.name}`,
          recoverable: false,
        },
      };
    }
    return def.execute(call.input, {
      ...context,
      guard: context.guard ?? this.pathGuard,
    });
  }
}

/** Convenience factory. */
export function createToolRegistryAdapter(
  adapter: unknown,
  policy: PolicyEngine,
  guard: PathGuard,
): ToolRegistry {
  void adapter;
  return new PolicyEngineToolRegistry(policy, guard);
}
