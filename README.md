# Toolify

**Toolify** is a VS Code extension that provides an AI-powered coding agent directly in your editor. It enables autonomous, multi-step coding tasks through a chat interface, with the ability to read/write files, run commands, search code, and manage complex workflows.

---

## What It Does

Toolify brings an AI agent into VS Code that can:

- **Autonomous task execution** — Give it a high-level goal (e.g., "add dark mode toggle", "refactor auth module", "write tests for user service") and it will plan, execute, and verify the work
- **Full codebase access** — Read, write, edit, search, and navigate files across your project
- **Command execution** — Run shell commands, tests, builds, linters, and any CLI tools
- **Multi-step reasoning** — Breaks complex tasks into steps, tracks progress, and adapts based on results
- **Session persistence** — Checkpoints and session history let you resume, review, or rollback work
- **Model flexibility** — Supports Anthropic, OpenAI-compatible APIs, and local models via configurable providers

---

## Architecture

### Core Components

| Module | Responsibility |
|--------|----------------|
| **Agent Loop** (`src/agent/`) | Main reasoning loop, context management, tool orchestration |
| **Tools** (`src/tools/`) | File ops, search, terminal, grep, glob, task delegation |
| **Models** (`src/models/`) | LLM provider abstractions (Anthropic, OpenAI-compatible, mock) |
| **Providers** (`src/providers/`) | Streaming, quota tracking, key verification |
| **Persistence** (`src/persistence/`) | Session checkpoints, repository pattern for storage |
| **Safety** (`src/safety/`) | Approval service for destructive operations |
| **UI** (`src/components/`, `webview-ui/`) | React-based chat interface, settings, model selection |
| **Auth** (`src/auth/`) | OAuth providers, session management, callback server |

### Key Design Patterns

- **Tool-based agent** — Agent invokes typed tools (read, write, edit, bash, grep, glob, task) with structured input/output
- **Streaming responses** — Real-time token streaming with usage tracking
- **Checkpoint system** — Automatic state snapshots for recovery and audit
- **Provider registry** — Pluggable model providers with unified interface
- **Extension host** — Runs as VS Code extension with webview for chat UI

---

## Project Structure

```
toolify/
├── src/
│   ├── agent/              # Agent loop, context, events, loop detector
│   ├── app/                # DI container, runtime context
│   ├── auth/               # OAuth providers (GitHub, etc.), session mgmt
│   ├── cli/                # CLI entry points (chat, run, onboarding)
│   ├── components/         # Settings, model selection, tool cards, modals
│   ├── core/               # Controllers (chat, config, terminal, state)
│   ├── models/             # Model registry, pricing, quota, verification
│   ├── persistence/        # Checkpoint store, session repository
│   ├── providers/          # Streaming provider, base provider class
│   ├── safety/             # Approval service for risky operations
│   ├── storage/            # Session storage abstraction
│   ├── theme/              # Theme system, ANSI colors, provider colors
│   ├── tools/              # Tool implementations (fs, search, terminal)
│   ├── utils/              # Config utilities
│   └── verify/             # Verification gate
├── webview-ui/             # React + Vite chat interface
├── tests/                  # Vitest suite (unit + integration)
├── dist/                   # Compiled JS output (committed for VS Code)
├── docs/                   # Architecture, limitations, phase docs
├── examples/               # Config templates
└── scripts/                # Build/start scripts
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- VS Code 1.80+
- API key for at least one provider (Anthropic, OpenAI, or compatible)

### Installation

```bash
# Clone and install
git clone <repo-url>
cd toolify
npm install

# Build extension
npm run build

# Run tests
npm test

# Package for VS Code
vsce package
```

### Development

```bash
# Watch mode for TypeScript compilation
npm run watch

# Launch extension in development host (F5 in VS Code)
# Or run CLI directly:
npm run dev
```

---

## Configuration

Create `toolify.config.json` in your workspace root:

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "${env:ANTHROPIC_API_KEY}",
      "model": "claude-3-5-sonnet-20241022"
    },
    "openai": {
      "apiKey": "${env:OPENAI_API_KEY}",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o"
    }
  },
  "defaultProvider": "anthropic",
  "approvalMode": "ask",  // "ask" | "auto" | "never"
  "maxTokens": 8192,
  "temperature": 0.1
}
```

See `examples/toolify.config.json` for full schema.

---

## Usage

1. **Open Toolify** — `Ctrl+Shift+P` → "Toolify: Open Chat"
2. **Select model** — Choose provider/model from settings
3. **Start task** — Describe what you want done in natural language
4. **Review & approve** — Agent shows proposed changes; approve each step
5. **Iterate** — Continue conversation to refine, test, or extend

### Example Prompts

- "Add a dark mode toggle to the settings page"
- "Write unit tests for the auth service"
- "Refactor the user repository to use the new database client"
- "Find and fix the memory leak in the websocket handler"
- "Create a new REST endpoint for exporting reports"

---

## Safety & Approvals

Toolify requests approval for:

- File writes/deletes
- Shell command execution
- Network requests
- Git operations

Modes: `ask` (default), `auto` (trusted environments), `never` (read-only).

---

## Testing

```bash
# Unit tests
npm test

# Specific test file
npm test -- tests/agent-loop.test.ts

# With coverage
npm run test:coverage
```

---

## Contributing

1. Fork the repo
2. Create feature branch
3. Make changes with tests
4. Run `npm run lint && npm test`
5. Submit PR

---

## License

MIT — see LICENSE file for details.

---

## Related

- [Architecture Documentation](docs/architecture.md)
- [Known Limitations](docs/known-limitations.md)
- [Phase 1 Runtime Boundaries](docs/phase-1-runtime-boundaries.md)