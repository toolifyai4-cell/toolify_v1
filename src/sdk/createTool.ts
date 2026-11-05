import type {
  ToolSchema,
  CreateToolOptions,
  ToolExecutor,
} from "./types";

/** Build a {@link ToolSchema} from a simple description.
 *
 *  The returned schema can be dropped straight into the agent's tool registry.
 */
export function createTool(opts: CreateToolOptions): ToolSchema {
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    // outputSchema is optional – the executor may return any shape.
  };
}

/** Convenience wrapper that turns a pure async function into a {@link ToolExecutor}.
 *
 *  Example:
 *  ```ts
 *  const myTool = createTool({
 *    name: "read-file",
 *    description: "Read a file from disk",
 *    inputSchema: { type: "object", properties: { path: { type: "string" } } },
 *    execute: async (input) => {
 *      const { path } = input;
 *      const content = await Bun.file(path).text();
 *      return { success: true, output: content };
 *    },
 *  });
 *  ```
 */
export function withExecutor(
  fn: (
    input: Record<string, unknown>
  ) => Promise<{
    success: boolean;
    output?: unknown;
    error?: string;
  }>
): ToolExecutor {
  return async (input) => {
    const result = await fn(input);
    return result; // passthrough
  };
}