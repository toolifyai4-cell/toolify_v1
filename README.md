<div align="center">

# ⚡ NEXIPI

**An AI-powered coding agent for your terminal and workspace.**

Plan, build, inspect, and verify code with a modern terminal-native agent interface.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

---

## ✨ What is NEXIPI?

**NEXIPI** is an AI coding agent that works directly inside your development workspace.  
Describe what you want in natural language, and NEXIPI can inspect your project, propose a plan, make changes, run commands, execute tests, and verify the result.

It is designed for developers who want an agent that is:

- **Terminal-native** — a fast, keyboard-first interface.
- **Workspace-aware** — understands files, Git state, commands, and project context.
- **Safe by default** — Plan mode prevents accidental changes.
- **Transparent** — every tool call, file edit, command, and result is visible.
- **Model-flexible** — works with Anthropic, OpenAI-compatible APIs, and local models.

---

## 🚀 Features

### 🧠 Autonomous coding workflow

Give NEXIPI a high-level task:

```text
Add dark mode support to the settings page
```

NEXIPI can:

1. Inspect relevant files.
2. Understand the existing implementation.
3. Propose a structured plan.
4. Apply approved changes.
5. Run tests or builds.
6. Report what changed and why.

### 🗂️ Workspace awareness

NEXIPI can work with your project through tools such as:

- Read and inspect files.
- Search code with grep-style queries.
- Navigate the workspace with glob patterns.
- Read Git status and repository context.
- Run shell commands, builds, linters, and tests.
- Create, edit, and update files with approval.

### 🔁 Plan and Build modes

NEXIPI separates thinking from execution.

| Mode | Purpose | File changes |
|---|---|---|
| **Plan** | Explore, analyze, and propose a solution | ❌ No writes |
| **Build** | Implement the approved plan | ✅ Writes allowed |

In **Plan mode**, NEXIPI can read and search your workspace but will not modify files.  
In **Build mode**, it can apply changes, run commands, and verify results.

### 📜 Scrollable chat interface

The terminal UI keeps the important controls fixed while letting you review the full session:

```text
┌──────────────────────────────────────────────────────────────┐
│ YOU                                                          │
│   Fix the login validation bug                               │
│                                                              │
│ NEXIPI                                                       │
│   I found an issue in validateToken(). Expired tokens        │
│   are accepted because the expiry check runs too late.       │
│                                                              │
│ TOOL read_file src/auth/login.ts — done                      │
│ TOOL search_code("validateToken") — done                     │
│                                                              │
│ PLAN                                                         │
│   1. Move expiry validation earlier                          │
│   2. Add a regression test                                   │
│   3. Run the auth test suite                                 │
│                                                              │
│ SYSTEM                                                       │
│   Switch to Build mode and implement this plan?              │
└──────────────────────────────────────────────────────────────┘

╭──────────────────────────────────────────────────────────────╮
│ You │ Type a message or / for commands...                    │
╰──────────────────────────────────────────────────────────────╯

 Model: gpt-5 | Tokens: 6.4K | Cost: $0.0162
 Plan [ON] | Build [OFF] | Auto-approve: OFF
```

### 🛡️ Safety and approvals

NEXIPI is built to be cautious with your workspace.

Approval controls can cover:

- File writes and deletions.
- Shell command execution.
- Git operations.
- Network requests.
- Potentially destructive actions.

You can configure approval behavior as:

| Mode | Behavior |
|---|---|
| `ask` | Ask before risky actions |
| `auto` | Automatically approve selected safe actions |
| `never` | Read-only mode |

### 💾 Sessions and checkpoints

NEXIPI can preserve session history and create checkpoints before important changes.

This helps you:

- Review what the agent did.
- Resume a previous session.
- Inspect tool activity.
- Roll back to a prior workspace state.

### 🔌 Pluggable model providers

NEXIPI supports a provider abstraction so you can choose the model that fits your workflow:

- Anthropic
- OpenAI-compatible APIs
- Local models
- Mock provider for development and testing

---

## 📦 Installation

### Prerequisites

- Node.js 18 or later
- npm
- VS Code 1.80 or later, if using the extension
- An API key for at least one supported provider

### Clone and install

```bash
git clone [https://github.com/](https://github.com/)<your-username>/nexipi.git
cd nexipi
npm install
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

### Package the VS Code extension

```bash
vsce package
```

---

## ⚙️ Configuration

Create a `toolify.config.json` file in your workspace root:

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "${env:ANTHROPIC_API_KEY}",
      "model": "claude-3-5-sonnet-20241022"
    },
    "openai": {
      "apiKey": "${env:OPENAI_API_KEY}",
      "baseUrl": "[https://api.openai.com/v1](https://api.openai.com/v1)",
      "model": "gpt-4o"
    }
  },
  "defaultProvider": "anthropic",
  "approvalMode": "ask",
  "maxTokens": 8192,
  "temperature": 0.1
}
```

Use environment variables for API keys. Avoid committing secrets to your repository.

---

## 🧭 Usage

### VS Code extension

1. Open the Command Palette.
2. Run `Toolify: Open Chat`.
3. Choose a model.
4. Describe your task.
5. Review the plan.
6. Approve Build mode when ready.

### CLI

```bash
npm run dev
```

Then type a task:

```text
Add input validation to the signup form
```

### Example prompts

```text
Add a dark mode toggle to the settings page
Write unit tests for the auth service
Refactor the user repository to use the new database client
Find and fix the memory leak in the WebSocket handler
Create a REST endpoint for exporting reports
Explain how authentication works in this project
```

---

## 🏗️ Architecture

```text
┌──────────────────────────────────────────────┐
│                Terminal / VS Code UI          │
│                                              │
│  Scrollable chat │ Tool logs │ Status bar    │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│               Agent Controller               │
│  Sessions │ Modes │ Events │ Cancellation    │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│                Agent Runtime                 │
│                                              │
│  Context Engine → Model Provider → Tools     │
│        ↑                            │        │
│        └────── Tool Results ─────────┘        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│           Permissions and Sandbox            │
│  Path guards │ Approvals │ Checkpoints       │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│                User Workspace                │
│     Files │ Git │ Commands │ Tests │ Builds  │
└──────────────────────────────────────────────┘
```

### Core modules

| Module | Responsibility |
|---|---|
| `src/agent/` | Agent loop, context management, events, loop detection |
| `src/tools/` | File operations, search, terminal, grep, glob, task tools |
| `src/models/` | Model registry, pricing, quota, verification |
| `src/providers/` | Streaming providers and provider abstractions |
| `src/persistence/` | Sessions, checkpoints, and storage |
| `src/safety/` | Approval service for risky operations |
| `src/components/` | Terminal UI components |
| `webview-ui/` | React + Vite chat interface |
| `src/verify/` | Verification gate for builds and tests |

---

## 🧪 Development

### Watch mode

```bash
npm run watch
```

### Run tests

```bash
npm test
```

### Run one test file

```bash
npm test -- tests/agent-loop.test.ts
```

### Coverage

```bash
npm run test:coverage
```

### Launch VS Code development host

Press `F5` in VS Code to launch the extension in a development host.

---

## 🤝 Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Add or update tests.
5. Run:

```bash
npm run lint
npm test
```

6. Open a pull request.

---

## 📄 License

Licensed under the [Apache License 2.0](./LICENSE).
