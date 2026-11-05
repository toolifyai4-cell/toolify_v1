export { createTool } from "./createTool";
export type {
  ToolSchema,
  CreateToolOptions,
  ToolExecutor,
  HookContext,
  ApprovalService,
} from "./types";
export { SimpleApprovalService } from "./approval";
export * from "./hooks";
export { scanPluginsDirectory, loadBuiltInPlugins } from "./scanner";

// Re‑export the HookRegistry and individual hook types for convenience
export {
  HookRegistry,
  hooks as hookTypes,
};
export * from "./agent";