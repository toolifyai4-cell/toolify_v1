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

// Multi‑agent team coordinator (new in v0.2.0)
export { TeamCoordinator } from "./teamCoordinator";

// Messaging hooks – Telegram, Slack, Discord (new in v0.3.0)
export { TelegramMessenger } from "./messaging/telegram";
export { SlackMessenger } from "./messaging/slack";
export { DiscordMessenger } from "./messaging/discord";