import React from "react";
import { render } from "ink";
import type { AgentMode, ToolCall } from "../agent/types.js";
import { PathGuard } from "../tools/fs-tools.js";
import { PolicyEngine, TOOL_SCHEMAS } from "../tools/registry.js";
import { TaskDigest } from "../agent/digest.js";
import { ContextManager } from "../agent/context.js";
import { CostMeter } from "../agent/meter.js";
import { LoopDetector } from "../agent/loop-detector.js";
import { AgentLoop, type ApprovalHandler } from "../agent/loop.js";
import { SessionStore } from "../storage/session.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { VerificationGate } from "../verify/gate.js";
import type { ToolifyConfig } from "./run.js";
import { createAdapter } from "./run.js";
import { ChatUI, type ChatMessage } from "../components/ChatUI.js";
import { clearScreen, patchTtyForFullScreen } from "./screen.js";
import { MenuScreen } from "../components/MenuScreen.js";
import { loadAuthSession } from "../auth/index.js";
import type { AuthUser } from "../auth/types.js";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

type AutoApproveMode = "off" | "writes" | "all";
const AUTO_ORDER: AutoApproveMode[] = ["off", "writes", "all"];

/**
 * ChatHost wraps ChatUI and holds the agent + live-display state in React
 * state, so every tool result / message triggers a re-render of the stream.
 * Exported so tests / smoke drivers can host it with a mocked stdin.
 */
export function ChatHost({
  workspace,
  cfg,
}: {
  workspace: string;
  cfg: ToolifyConfig;
}): React.ReactElement {
  const adapter = React.useMemo(() => createAdapter(cfg), [cfg]);
  const guard = React.useMemo(() => new PathGuard(workspace), [workspace]);
  const policy = React.useMemo(() => new PolicyEngine(cfg.policy ?? {}), [cfg]);
  const meterRef = React.useRef<CostMeter | null>(null);
  if (meterRef.current === null) meterRef.current = new CostMeter(adapter.pricing);
  const sessionsRef = React.useRef<SessionStore | null>(null);
  if (sessionsRef.current === null) {
    sessionsRef.current = new SessionStore(workspace, SessionStore.newId());
  }
  const checkpointsRef = React.useRef<CheckpointStore | null>(null);
  if (checkpointsRef.current === null) checkpointsRef.current = new CheckpointStore(workspace);
  const [mode, setMode] = React.useState<AgentMode>("act");
  const [autoApprove, setAutoApprove] = React.useState<AutoApproveMode>("off");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = React.useState(false);
  const [turnCount, setTurnCount] = React.useState(0);
  const [showMenu, setShowMenu] = React.useState(false);

  const session = React.useMemo(() => loadAuthSession(workspace), [workspace]);
  const userName = session?.user?.name ?? "User";

  const [history, setHistory] = React.useState<Array<{ role: "user" | "assistant"; preview: string; ts: number }>>([]);

  React.useEffect(() => {
    sessionsRef.current?.init();
    checkpointsRef.current?.init();
    // Load recent history from session logs
    const sessDir = join(workspace, ".toolify", "sessions");
    if (existsSync(sessDir)) {
      try {
        const dirs = readdirSync(sessDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort()
          .slice(-5);
        const items: Array<{ role: "user" | "assistant"; preview: string; ts: number }> = [];
        for (const id of dirs) {
          const logPath = join(sessDir, id, "events.jsonl");
          if (!existsSync(logPath)) continue;
          const fs = require("node:fs");
          const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
          for (const line of lines.slice(-20)) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === "user_message" && ev.content) {
                items.push({ role: "user", preview: ev.content, ts: ev.ts ?? Date.now() });
              } else if (ev.type === "assistant_text" && ev.content) {
                items.push({ role: "assistant", preview: ev.content, ts: ev.ts ?? Date.now() });
              }
            } catch {}
          }
        }
        setHistory(items.slice(-12));
      } catch {}
    }
  }, [workspace]);

  const mutateMessages = React.useCallback((fn: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => fn(prev));
    }, []);

  const approval = React.useMemo(
    (): ApprovalHandler => ({
      request: async (call: ToolCall, _reason: string) => {
        if (autoApprove === "all") return { approved: true, scope: "session" };
        if (autoApprove === "writes" && call.name !== "terminal") {
          return { approved: true, scope: "session" };
        }
        return { approved: false };
      },
    }),
    [autoApprove],
  );

  const onSubmit = React.useCallback(
    async (input: string) => {
      if (input.startsWith("/")) {
        if (input === "/clear") setMessages([]);
        if (input === "/exit" || input === "/quit") process.exit(0);
        if (input === "/" || input === "/menu") setShowMenu(true);
        return;
      }

      mutateMessages((prev) => [...prev, { role: "user", content: input }]);
      setTurnCount((t) => t + 1);
      setIsRunning(true);

      const digest = new TaskDigest(input);
      const context = new ContextManager(adapter, digest, { contextWindow: cfg.contextWindow });
      const verification = new VerificationGate(guard, () => {}, {
        commands: cfg.verification?.commands ?? [],
        maxRounds: cfg.verification?.maxRounds ?? 3,
      });

      const loop = new AgentLoop({
        adapter,
        guard,
        policy,
        digest,
        context,
        meter: meterRef.current!,
        sessions: sessionsRef.current!,
        checkpoints: checkpointsRef.current!,
        verification,
        approval,
        loopDetector: new LoopDetector(),
        tools: TOOL_SCHEMAS,
        maxIterations: cfg.maxIterations ?? 40,
        mode,
        onStream: {
          onAssistantText: (text) => {
            mutateMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: last.content + text }];
              }
              return [...prev, { role: "assistant", content: text }];
            });
          },
          onToolStart: (call) => {
            mutateMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                return [...prev.slice(0, -1), {
                  ...last,
                  toolCalls: [...(last.toolCalls ?? []), call],
                }];
              }
              return [...prev, { role: "assistant", content: "", toolCalls: [call] }];
            });
          },
          onToolResult: (callId, result, isError) => {
            mutateMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                const tr = last.toolResults ?? [];
                tr.push({ callId, content: result, isError });
                return [...prev.slice(0, -1), { ...last, toolResults: tr }];
              }
              return prev;
            });
          },
          onStatus: () => setTurnCount((t) => t),
        },
      });

      try {
        await loop.run(input);
      } finally {
        setIsRunning(false);
      }
    },
        [adapter, guard, policy, cfg, mode, approval, mutateMessages],
  );

  if (showMenu && session?.user) {
    return (
      <MenuScreen
        userName={userName}
        user={session.user}
        config={cfg}
        usage={{
          inputTokens: meterRef.current.usage.inputTokens,
          outputTokens: meterRef.current.usage.outputTokens,
          costUsd: meterRef.current.costUsd,
        }}
        history={history}
        onEnter={() => setShowMenu(false)}
        onEsc={() => setShowMenu(false)}
      />
    );
  }

  return (
    <ChatUI
      messages={messages}
      status={{
        model: cfg.model,
        inputTokens: meterRef.current.usage.inputTokens,
        outputTokens: meterRef.current.usage.outputTokens,
        costUsd: meterRef.current.costUsd,
        turnCount,
      }}
      mode={mode}
      autoApprove={autoApprove}
      workspace={workspace}
      isRunning={isRunning}
      onSubmit={onSubmit}
      onModeToggle={() => setMode((m) => (m === "plan" ? "act" : "plan"))}
      onAutoApproveToggle={() =>
        setAutoApprove((a) => AUTO_ORDER[(AUTO_ORDER.indexOf(a) + 1) % AUTO_ORDER.length])
      }
      onClear={() => setMessages([])}
      onExit={() => process.exit(0)}
      onCancel={() => process.exit(0)}
    />
    );
}

/** Entry point used by the CLI: renders the full-screen interface. */
export async function startChat(workspace: string, cfg: ToolifyConfig): Promise<void> {
  // Ink only erases its frame in interactive mode, and npx/tsx on Windows
  // often reports isTTY=false even inside a real terminal, so force it on.
  patchTtyForFullScreen();
  // Wipe the entry flow's final frame so the chat starts on a clean screen.
  clearScreen();

  const { unmount } = render(React.createElement(ChatHost, { workspace, cfg }), {
    exitOnCtrlC: false,
    interactive: true,
  });
  process.on("SIGINT", () => {
    unmount();
    process.exit(0);
  });
}


