# Plan: Refactor README.md for VS Code Extension

## Context

The nexipi/toolify_v1 project has migrated from a terminal-native interface to a VS Code extension, but `README.md` still describes the terminal interface. The README needs to be rewritten to reflect the current extension architecture.

## Current state (verified from codebase)

**Extension entry point:** `src/extension.ts`
- Registers `toolifyChatView` webview view in VS Code Explorer sidebar
- Wires gRPC service handlers: StateService, ChatService, ConfigService, TerminalService, AuthService
- Auto-focuses Explorer sidebar and reveals TOOLIFY view on activate

**Webview architecture:**
- `src/core/webview/WebviewProvider.ts` — abstract base for gRPC routing + HTML injection
- `src/hosts/vscode/VscodeWebviewProvider.ts` — concrete VS Code webview provider
- Communication: Webview → extension via `WebviewMessage { type: "grpc_request" }`; extension → webview via `ExtensionMessage { type: "grpc_response" }`
- HTML loads built assets from `dist/webview-ui/assets/` (or dev mode at `localhost:5173`)

**Webview UI (React + Vite):** `webview-ui/src/`
- `App.tsx`, `Providers.tsx`, `main.tsx`
- Components: `ChatView.tsx`, `WelcomeView.tsx`, `SettingsModal.tsx`, `HistoryModal.tsx`, `AccountModal.tsx`
- Services: `grpc-client.ts`, `grpc-client-base.ts`
- Context: `ExtensionStateContext.tsx`

**Session management:** `src/extension/agent-session-manager.ts`
- Manages long-running `AgentLoop` instances keyed by session ID
- Wires stream callbacks into `GrpcStateEmitter` for webview streaming

**Auth:** `src/extension/auth-integration.ts`
- VS Code `vscode.authentication.getSession` native sign-in + session store fallback

**package.json:**
- `main: ./dist/extension.js`, `bin: nexipi: ./dist/index.js`
- `contributes.views.explorer`: `toolifyChatView` named "TOOLIFY"
- Scripts: `nexipi`, `chat`, `dev`, `dev:webview`, `test`, `typecheck`, `build`, `build:webview`, `launch` (`code --extensionDevelopmentPath=.`), `start`, `vscode`, `prepublish`

## What the README currently says (outdated)

- Tagline: "AI-powered coding agent for your terminal and workspace"
- "Terminal-native — a fast, keyboard-first interface"
- ASCII-art scrollable chat terminal UI example
- `npm run watch` (does not exist in package.json)
- `vsce package` for packaging
- Architecture diagram labels "Terminal / VS Code UI"
- Core modules table lists `src/components/` Terminal UI components (does not exist)

## Refactor decisions

1. **Headline/tagline**: Change from "terminal and workspace" to "VS Code extension". Remove "terminal-native" descriptor.
2. **Features section**: Reframe terminal UI references as webview/sidebar UI. Keep plan/build modes, safety, sessions, providers (all still valid).
3. **Scrollable chat UI example**: Replace terminal ASCII art with VS Code sidebar/webview description.
4. **Installation**: Lead with VS Code extension installation (install from VSIX or run `npm run build` + `launch`). Keep CLI as secondary.
5. **Configuration**: Keep `toolify.config.json` section (still valid).
6. **Usage**: Lead with Command Palette (`Toolify: Open Chat`), webview sidebar. Keep CLI as secondary (`npm run dev` / `npm run chat`).
7. **Architecture**: Update Mermaid diagram to show VS Code Extension Host ↔ Webview ↔ gRPC ↔ Agent Loop ↔ Workspace.
8. **Core modules table**: Remove `src/components/` Terminal UI row. Add `src/extension/`, `src/hosts/vscode/`, `webview-ui/`, `src/core/webview/`. Keep agent/tools/models/providers/persistence/safety/verify.
9. **Development**: Remove `npm run watch` (doesn't exist). Add `npm run dev:webview` and `npm run launch` (F5 in VS Code). Keep `npm test`, `npm run typecheck`.
10. **Remove**: `vsce package` section unless vsce is actually configured (not in package.json devDeps).

## Validation

- `npm run typecheck` should pass (README doesn't affect this, but confirm no broken references)
- README should not mention "terminal-native", "keyboard-first", `npm run watch`, `src/components/`, or `vsce package`
- README should mention: VS Code extension, `toolifyChatView`, webview sidebar, Command Palette, `npm run launch`, `npm run dev:webview`, gRPC services, `webview-ui/`

## Open question

Should the CLI be documented as a secondary/alternative interface, or removed entirely from the README? The `src/index.ts` entry and `nexipi`/`chat`/`dev` scripts still exist, so CLI still works. Recommendation: keep CLI as a short "Alternative: CLI" section, lead with extension.
