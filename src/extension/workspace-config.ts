/**
 * WorkspaceConfig — workspace-aware configuration loading for the extension host.
 *
 * Replaces the CLI's `process.cwd()` / `resolveWorkspace()` logic with
 * `vscode.workspace.workspaceFolders` so config is loaded relative to the
 * currently opened VS Code workspace folder.
 */
import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolifyConfig, resolveApiKeySync, resolveBaseUrlSync } from "../utils/config.js";
import type { ModelAdapter } from "../agent/types.js";
import { OpenAICompatibleAdapter } from "../models/openai-compatible.js";
import { AnthropicAdapter } from "../models/anthropic.js";
import { MockModelAdapter } from "../models/mock.js";

/**
 * Resolve the active workspace folder. Returns the first workspace folder,
 * or the URI of the active text editor's file if no workspace folder is open.
 */
export function resolveWorkspaceFolder(): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return editor.document.uri;
  }
  return undefined;
}

/**
 * Load ToolifyConfig from `.toolify/config.json` inside the active workspace folder.
 */
export async function loadWorkspaceConfig(): Promise<ToolifyConfig> {
  const workspaceUri = resolveWorkspaceFolder();
  if (!workspaceUri) {
    throw new Error(
      "No workspace folder is open. Open a folder in VS Code to use TOOLIFY.",
    );
  }

  const configPath = resolve(workspaceUri.fsPath, ".toolify", "config.json");
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as ToolifyConfig;
}

/**
 * Check whether a `.toolify/config.json` exists in the active workspace folder.
 */
export function hasWorkspaceConfig(): boolean {
  const workspaceUri = resolveWorkspaceFolder();
  if (!workspaceUri) return false;
  const fs = require("node:fs");
  return fs.existsSync(resolve(workspaceUri.fsPath, ".toolify", "config.json"));
}

/**
 * Create a model adapter from the workspace config.
 * Replaces the deleted `cli/run.ts` `createAdapter`.
 */
export function createAdapter(cfg: ToolifyConfig, workspace: string): ModelAdapter {
  // The workspace-config ToolifyConfig uses apiKeys/baseUrls records.
  // Resolve the first configured provider.
  const providerIds = Object.keys(cfg.apiKeys);
  const provider = providerIds[0] ?? "mock";
  const apiKey = cfg.apiKeys[provider] ?? undefined;
  const baseUrl = cfg.baseUrls[provider] ?? undefined;

  if (provider === "anthropic") {
    if (!apiKey) {
      return new MockModelAdapter([{ text: "Set ANTHROPIC_API_KEY to use the Anthropic adapter.", finishReason: "stop" as const }]);
    }
    return new AnthropicAdapter({ apiKey, model: "claude-3-5-sonnet-20241022" });
  }
  if (provider === "openai" || provider === "deepseek" || provider === "groq" || provider === "perplexity" || provider === "ollama" || provider === "lmstudio" || provider === "vllm") {
    if (!apiKey && provider !== "ollama" && provider !== "lmstudio" && provider !== "vllm") {
      return new MockModelAdapter([{ text: `Set ${provider.toUpperCase()}_API_KEY to use the ${provider} adapter.`, finishReason: "stop" as const }]);
    }
    return new OpenAICompatibleAdapter({
      baseUrl: baseUrl ?? "https://api.openai.com/v1",
      apiKey: apiKey ?? "",
      model: "gpt-4o",
      providerId: provider,
    });
  }
  if (provider === "gemini") {
    if (!apiKey) {
      return new MockModelAdapter([{ text: "Set GEMINI_API_KEY to use the Gemini adapter.", finishReason: "stop" as const }]);
    }
    return new OpenAICompatibleAdapter({
      baseUrl: baseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey,
      model: "gemini-1.5-pro",
      providerId: "gemini",
    });
  }
  // Default: mock adapter
  return new MockModelAdapter([{ text: "Mock adapter: no real provider configured. Add API keys to .toolify/config.json.", finishReason: "stop" as const }]);
}
