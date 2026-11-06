import type { PolicyDecision, RiskTier, ToolCall, ToolSchema } from "../agent/types.js";
import { PathGuard, globToRegExp } from "./fs-tools.js";
import { redactSecrets, hasSecrets, type SECRET_PATTERNS } from "./secret-redaction.js";
import {
  editFileTool,
  readFileTool,
  writeFileTool,
} from "./fs-tools.js";
import { globTool, grepTool } from "./search-tools.js";
import { terminalTool, type TerminalResult } from "./terminal-tool.js";
export interface ProjectPolicyConfig {
  /** Command prefixes always allowed without approval (allowlisted). */
  allowlist?: string[];
  /** Paths (glob) never readable/writable, e.g. ".env*". */
  denyPaths?: string[];
}

export let TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path, relative to workspace" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Edit an existing file by replacing old_text with new_text. old_text must match exactly once.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "glob",
    description: "Find files by filename pattern (supports *, **, ?).",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
    {
    name: "glob",
    description: "Find files by filename pattern (supports *, **, ?).",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "list_files",
    description: "List files in the workspace matching a glob pattern (alias of glob).",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regex; returns path:line: text hits.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, glob: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "search_files",
    description: "Search file contents for a pattern (alias of grep).",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, glob: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "terminal",
    description: "Run a shell command in the workspace (PowerShell on Windows).",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["command"],
    },
  },
  {
    name: "test",
    description: "Run a test suite (Vitest, Jest, PyTest, etc.) and return results with failures and stacks.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Test command to run, e.g., 'npx vitest run', 'npm test', 'pytest', 'cargo test'"
        },
        testFramework: {
          type: "string",
          description: "Optional framework: vitest, jest, pytest, cypress, etc."
        }
      },
      required: ["command"]
    }
  }
];

/** Add extra tool schemas to the global schema list (e.g. discovered plugins). */
export function addToolSchemas(schemas: ToolSchema[]): void {
  TOOL_SCHEMAS = [...TOOL_SCHEMAS, ...schemas];
}

/** Exported so the ToolDefinition adapter can look up the risk tier. */
export const TIER_BY_TOOL: Record<string, RiskTier> = {
  read_file: "read",
  glob: "read",
  grep: "read",
  list_files: "read",
  search_files: "read",
  write_file: "write",
  edit_file: "write",
  terminal: "dangerous",
  test: "read",
};

/**
 * Risk-tiered policy engine (R5).
 * Reads auto-allowed; writes gated; terminal commands matched against the
 * project allowlist; per-session grants remembered — replacing Cline's
 * binary approve/deny approval fatigue.
 */
export class PolicyEngine {
  private readonly allowlistRes: RegExp[];
  private readonly denyRes: RegExp[];
  private readonly sessionGrants = new Set<RiskTier>();

  constructor(private readonly config: ProjectPolicyConfig = {}) {
    this.allowlistRes = (config.allowlist ?? []).map((a) => globToRegExp(a.toLowerCase()));
    this.denyRes = (config.denyPaths ?? []).map((d) => globToRegExp(d.toLowerCase()));
  }

  grantForSession(tier: RiskTier): void {
    this.sessionGrants.add(tier);
  }

  private hasGrant(tier: RiskTier): boolean {
    return this.sessionGrants.has(tier);
  }

  /** Check if the tool input contains any known secret patterns. */
  private hasSecretsInInput(input: Record<string, unknown>): boolean {
    const scanValues = (obj: Record<string, unknown>): string[] => {
      const hits: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const strValue = String(value);
        if (hasSecrets(strValue)) {
          hits.push(`${key}: *redacted*`);
        }
        if (value && typeof value === "object") {
          hits.push(...scanValues(value as Record<string, unknown>));
        }
      }
      return hits;
    };

    return scanValues(input).length > 0;
  }

  decide(call: ToolCall): PolicyDecision {
    const tier = TIER_BY_TOOL[call.name] ?? "dangerous";
    const input = (call.input ?? {}) as Record<string, unknown>;

    // Check for secrets in tool inputs before proceeding
    const hasSecretInput = hasSecretsInInput(input);
    if (hasSecretInput) {
      return {
        allowed: false,
        tier,
        reason: `Tool "${call.name}" contains detected secrets — redaction required or provide clean input`,
      };
    }

    const path = typeof input.path === "string" ? input.path.toLowerCase() : null;
    if (path && this.denyRes.some((re) => re.test(path))) {
      return {
        allowed: false,
        tier,
        reason: `Path "${input.path}" is denied by project denyPaths policy`,
      };
    }

    if (tier === "read") {
      // Read-only tools are auto-allowed, but redact any secrets in output later
      return { allowed: true, tier, reason: "read-only tools are auto-allowed" };
    }

    if (this.hasGrant(tier)) {
      return {
        allowed: true,
        tier,
        reason: `per-session grant for ${tier} tier`,
        allowlisted: true,
      };
    }

    if (call.name === "terminal" && typeof input.command === "string") {
      const cmd = input.command.toLowerCase().trim();
      if (this.allowlistRes.some((re) => re.test(cmd))) {
        return {
          allowed: true,
          tier,
          reason: "command matches project allowlist",
          allowlisted: true,
        };
      }
      return {
        allowed: false,
        tier,
        reason: `terminal command not in allowlist: ${input.command.slice(0, 120)}`,
      };
    }

    return { allowed: false, tier, reason: `${tier}-tier tool "${call.name}" requires approval` };
  }

  async execute(guard: PathGuard, call: ToolCall): Promise<string | TerminalResult> {
    const input = (call.input ?? {}) as Record<string, unknown>;
    let result: string | TerminalResult;

    switch (call.name) {
      case "read_file":
        result = await readFileTool(guard, input as never);
        break;
      case "write_file":
        return writeFileTool(guard, input as never);
      case "edit_file":
        return editFileTool(guard, input as never);
      case "glob":
        return globTool(guard, input as never);
      case "grep":
        return grepTool(guard, input as never);
      case "list_files":
        return globTool(guard, input as never);
      case "search_files":
        return grepTool(guard, input as never);
      case "terminal":
        return terminalTool(guard, input as never);
      case "test":
        // Run test command via terminal
        const cmd = (call.input ?? {}).command as string;
        return terminalTool(guard, { command: cmd, timeoutMs: 120_000 });
        default:
        return `Unknown tool: ${call.name}`;
    }
  }
}
