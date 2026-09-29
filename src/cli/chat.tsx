import React from "react";
import { render, useApp } from "ink";
import type { AgentMode, ToolCall } from "../agent/types.js";
import { type ApprovalHandler, type AgentLoop, createAgentLoop } from "../agent/loop.js";
import { createAgentContainer } from "../app/container.js";
import { CostMeter } from "../agent/meter.js";
import { SessionStore } from "../storage/session.js";
import { CheckpointStore } from "../checkpoint/store.js";
import type { ToolifyConfig } from "./run.js";
import { createAdapter } from "./run.js";
import { saveConfig } from "./run.js";
import { applyDraftToConfig, draftFromParts } from "../components/settings.js";
import { loadGlobalPlugins } from "../components/plugins.js";
import type { SettingsDraft } from "../components/settings.js";
import { getAllConfiguredModels, type ModelDescriptor } from "../models/model-registry.js";
import { getQuota } from "../models/quota-tracker.js";
import { ChatUI, type ChatMessage } from "../components/ChatUI.js";
import { buildSessionSummary } from "./session-summary.js";
import { ThemeProvider } from "../theme/ThemeContext.js";
import { MenuScreen } from "../components/MenuScreen.js";
import { loadAuthSession } from "../auth/index.js";
import type { AuthUser } from "../auth/types.js";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { clearScreen, patchTtyForFullScreen } from "./screen.js";

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
  initialSettingsOpen,
}: {
  workspace: string;
  cfg: ToolifyConfig;
  initialSettingsOpen?: boolean;
}): React.ReactElement {
  const [liveCfg, setLiveCfg] = React.useState<ToolifyConfig>(cfg);
    const adapter = React.useMemo(() => createAdapter(liveCfg, workspace), [liveCfg, workspace]);
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
  const turnCountRef = React.useRef(0);
  const loopRef = React.useRef<AgentLoop | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const [showMenu, setShowMenu] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(initialSettingsOpen === true);
  // --- /models picker state ---
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const [modelsList, setModelsList] = React.useState<ModelDescriptor[] | null>(null);
  const [modelsLoading, setModelsLoading] = React.useState(false);

  // --- Quota state (read from getQuota() per current model/provider) ---
  const quota = React.useMemo(() =>
    getQuota(liveCfg.provider, liveCfg.model) ?? null,
  [liveCfg.provider, liveCfg.model]);

  const openModels = React.useCallback(() => {
    setModelsOpen(true);
    setModelsLoading(true);
    setModelsList(null);
    void getAllConfiguredModels().then(
      (list) => setModelsList(list),
      () => setModelsList([]),
    ).finally(() => setModelsLoading(false));
  }, []);

  const closeModels = React.useCallback(() => setModelsOpen(false), []);

  const commitModel = React.useCallback(
    (model: string, providerId: string) => {
      setLiveCfg((prev) => {
        const next: ToolifyConfig = {
          ...prev,
          model,
          provider: providerId as ToolifyConfig["provider"],
        };
        // Persist the active model + provider to the workspace config the
        // app loads at startup (the global store keeps credentials only).
        void saveConfig(workspace, next).catch(() => {});
        return next;
      });
      setModelsOpen(false);
    },
    [workspace],
  );

  const startedAtRef = React.useRef<number>(Date.now());

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

  const { exit } = useApp();

  const settingsInitial: SettingsDraft = React.useMemo(
    () => draftFromParts({
      provider: liveCfg.provider,
      model: liveCfg.model,
      mode,
      theme: liveCfg.theme,
      autoApprove,
      autoUpdate: liveCfg.autoUpdate,
      // Plugin state is global (~/.toolify/config.json), not per-workspace.
      plugins: loadGlobalPlugins(),
    }),
    [liveCfg.provider, liveCfg.model, liveCfg.theme, liveCfg.autoUpdate, mode, autoApprove],
  );

  const exitWithSummary = React.useCallback(() => {
    const meter = meterRef.current;
    const summary = buildSessionSummary({
      model: cfg.model,
      startedAtMs: startedAtRef.current,
      endedAtMs: Date.now(),
      inputTokens: meter?.usage.inputTokens ?? 0,
      outputTokens: meter?.usage.outputTokens ?? 0,
    });
    exit();
    // Print on the next tick so Ink's unmount/erase pass finishes first;
    // otherwise the frame teardown wipes the summary off the screen.
    setTimeout(() => {
      process.stdout.write("\u001Bc");
      console.log(summary);
      process.exit(0);
    }, 50);
  }, [cfg.model, exit]);

  React.useEffect(() => {
    const onSigint = (): void => { exitWithSummary(); };
    process.on("SIGINT", onSigint);
    return () => { process.off("SIGINT", onSigint); };
  }, [exitWithSummary]);

  const saveSettings = React.useCallback((draft: SettingsDraft) => {
    const next = applyDraftToConfig(liveCfg, draft);
    setLiveCfg(next);
    setMode(draft.mode);
    setAutoApprove(draft.autoApprove);
    setSettingsOpen(false);
    void saveConfig(workspace, next).catch(() => {});
  }, [liveCfg, workspace]);

  const mutateMessages = React.useCallback((fn: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => fn(prev));
    }, []);

  /**
   * Called when the user presses Esc during an active run.
   * Aborts the in-flight HTTP request, resets the running state, and
   * renders a [CANCELLED] badge in the chat stream.
   */
  const onCancel = React.useCallback(() => {
    const controller = abortControllerRef.current;
    if (controller) {
      controller.abort();
    }
    setIsRunning(false);
    abortControllerRef.current = null;
    mutateMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.thinking) {
        return [...prev.slice(0, -1), { ...last, thinking: false }];
      }
      return prev;
    });
    mutateMessages((prev) => [
      ...prev,
      { role: "assistant", content: "[CANCELLED] Operation stopped by user." },
    ]);
  }, [mutateMessages]);

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
        const cmd = input.trim().toLowerCase();
        if (cmd === "/clear") setMessages([]);
        else if (cmd === "/quit" || cmd === "/exit") { exitWithSummary(); return; }
        else if (cmd === "/help") {
          mutateMessages((prev) => [...prev, {
            role: "assistant",
            content: ["/settings - Modify agent configuration", "/model - Switch model or provider", "/theme - Change color theme", "/account - View Toolify account", "/history - Recent conversation turns", "/help - Show available commands", "/usage - View token consumption and cost", "/quit - Exit TOOLIFY application"].join("\n"),
          }]);
        }
        else if (cmd === "/usage") {
          const m = meterRef.current!;
          const cost = m.pricingUnknown
            ? "Cost: unknown (set `pricing` in .toolify/config.json)"
            : `Cost: $${m.costUsd.toFixed(4)}`;
          mutateMessages((prev) => [...prev, {
            role: "assistant",
            content: `Tokens: ${m.usage.inputTokens} in / ${m.usage.outputTokens} out | ${cost} | Turns: ${turnCountRef.current}`,
          }]);
        }
        else if (cmd === "/history") {
          mutateMessages((prev) => [...prev, {
            role: "assistant",
            content: history.length === 0 ? "No history yet." : history.slice(-10).map((h) => `${h.role}: ${h.preview}`).join("\n"),
          }]);
        }
        else if (cmd === "/settings") setSettingsOpen(true);
        else if (cmd === "/model" || cmd === "/models") openModels();
        else if (cmd === "/" || cmd === "/menu" || cmd === "/theme" || cmd === "/account") setShowMenu(true);
        return;
      }

      mutateMessages((prev) => [...prev, { role: "user", content: input }]);
      turnCountRef.current += 1;
      setTurnCount(turnCountRef.current);
      setIsRunning(true);
      // Render the thinking placeholder immediately so the user sees progress
      // before the first provider token arrives (cleared on first token).
      mutateMessages((prev) => [...prev, { role: "assistant", content: "", thinking: true }]);

      // Abort controller allows Esc / Ctrl+Backspace to cancel the in-flight
      // HTTP request instead of letting it hang until timeout.
            const controller = new AbortController();
      abortControllerRef.current = controller;

      const deps = createAgentContainer({
        workspace,
        model: adapter,
        goal: input,
        mode,
        maxIterations: cfg.maxIterations ?? 40,
        policyConfig: liveCfg.policy ?? {},
        verificationCommands: liveCfg.verification?.commands ?? [],
        verificationMaxRounds: liveCfg.verification?.maxRounds ?? 3,
        contextWindow: liveCfg.contextWindow,
        signal: controller.signal,
        sessionId: sessionsRef.current?.id,
        approval,
        onStream: {
          // Clear the "thinking" placeholder as soon as the provider produces
          // its first token. Without this the placeholder is only cleared
          // incidentally, by onAssistantText appending into it — so a turn that
          // yields no assistant text (tool-only, error, or abort) would strand
          // a permanent "..." in the transcript.
          onFirstToken: () => {
            mutateMessages((prev) =>
              prev.map((m) =>
                m.role === "assistant" && m.thinking ? { ...m, thinking: false } : m,
              ),
            );
          },
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
          onError: (banner, kind) => {
            // Clear the thinking placeholder so we don't show a duplicate
            // spinner alongside the error banner.
            mutateMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.thinking) {
                return [...prev.slice(0, -1), { ...last, content: "", thinking: false }];
              }
              return prev;
            });
            mutateMessages((prev) => [
              ...prev,
              { role: "assistant", content: banner },
            ]);
          },
        },
      });

      await deps.sessions.init();
      await deps.checkpoints.init();

      const loop = createAgentLoop(deps);

      try {
        await loop.run(input);
      } catch (err) {
        // Errors are classified and rendered as banners by the loop's onError
        // hook; re-throw only for unexpected exceptions we didn't classify.
        if (err instanceof Error && err.name === "AbortError") {
          // The request was aborted — onError already fired the banner.
        }
      } finally {
        // Sync usage into the persistent meter ref for /usage and the status bar.
        // This MUST run after loop.run(): the container builds a fresh CostMeter
        // each turn, and usage only accumulates into it during the run. Syncing
        // before the run (the old behaviour) always copied {0, 0}, so the UI
        // showed "Tokens: 0" even though the session log recorded real usage.
        meterRef.current!.add(deps.meter.usage);
        setTurnCount((t) => t); // re-render so the status bar refreshes
        setIsRunning(false);
        abortControllerRef.current = null;
        // Drop ANY leftover thinking placeholder, not just a trailing one.
        // A turn that produces no assistant text (tool-only, error, or abort)
        // would otherwise strand its "..." indicator permanently on screen.
        mutateMessages((prev) => {
          const cleaned = prev.filter(
            (m) => !(m.role === "assistant" && m.thinking && !m.content),
          );
          return cleaned.length === prev.length ? prev : cleaned;
        });
      }
    },
        [adapter, liveCfg, mode, approval, mutateMessages],
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
        model: liveCfg.model,
        inputTokens: meterRef.current.usage.inputTokens,
        outputTokens: meterRef.current.usage.outputTokens,
        turnCount,
        remainingTokens: quota?.remainingTokens,
        limitTokens: quota?.limitTokens,
        isExhausted: quota?.isExhausted ?? false,
        resetTime: quota?.resetTime,
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
      onExit={exitWithSummary}
      onCancel={onCancel}
      settingsOpen={settingsOpen}
      settingsInitial={settingsInitial}
      settingsSessionDir={sessionsRef.current?.sessionDir ?? null}
      settingsUsage={{
        inputTokens: meterRef.current.usage.inputTokens,
        outputTokens: meterRef.current.usage.outputTokens,
      }}
      onSettingsSave={saveSettings}
      onSettingsModeChange={setMode}
      onSettingsAutoApproveChange={setAutoApprove}
      modelsOpen={modelsOpen}
      models={modelsList}
      modelsLoading={modelsLoading}
      activeModel={liveCfg.model}
      activeProviderId={liveCfg.provider}
      onModelsCommit={commitModel}
      onModelsClose={closeModels}
    />
    );
}

/** Entry point used by the CLI: renders the full-screen interface. */
export async function startChat(workspace: string, cfg: ToolifyConfig): Promise<void> {
  // Force TTY mode so Ink enables full-screen rendering (required for
  // height={height} on the root <Box> to pin the input/status bar to the
  // bottom edge). patchTtyForFullScreen() only sets isTTY=true -- it emits
  // no ANSI codes and does NOT touch the scrollback buffer.
  //
  // clearScreen() writes ESC[2J ESC[H: this clears the *visible* viewport
  // and parks the cursor top-left, but deliberately does NOT emit ESC[3J,
  // so all prior entry-flow output (splash, auth, wizard) slides into the
  // terminal's native scrollback rather than being destroyed. This gives us
  // a clean canvas for the full-screen chat layout while preserving history.
  patchTtyForFullScreen();
  clearScreen();

  const { unmount } = render(
        React.createElement(ThemeProvider, {
      workspace,
      provider: cfg.provider,
      children: React.createElement(ChatHost, { workspace, cfg }),
    }),
    {
      // Enable the kitty keyboard protocol so the terminal disambiguates
      // Ctrl+Shift+Backspace from plain Backspace. Without it both arrive as
      // 0x7f and the quit shortcut can never fire.  The
      // reportAllKeysAsEscapeCodes flag is required for *non-printable* keys
      // (Backspace, Delete, arrows) to be reported through the protocol
      // instead of as raw bytes — plain Backspace would otherwise be
      // indistinguishable from Ctrl+Shift+Backspace.
      exitOnCtrlC: false,
      interactive: true,
      kittyKeyboard: {
        mode: "enabled",
        flags: ["reportAllKeysAsEscapeCodes"],
      },
    },
  );
    process.on("SIGINT", () => {
    unmount();
    process.exit(0);
  });
}

/**
 * Activity kinds surfaced by the live status bar in the chat TUI
 * (Claude-style rotating thinking synonyms).
 */
export type AgentActivity =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "composing" }
  | { kind: "tool"; name: string };

const THINKING_FRAMES = ["Calibrating…", "Thinking…", "Processing…", "Reasoning…"];

/**
 * Map a live activity + tick counter to a short, human-readable status label.
 * `idle` yields no label (nothing to report). `thinking` cycles through a set
 * of synonyms so the status bar never looks frozen.
 */
export function activityText(activity: AgentActivity, tick: number): string | undefined {
  switch (activity.kind) {
    case "idle":
      return undefined;
    case "thinking":
      return THINKING_FRAMES[(((tick ?? 0) % THINKING_FRAMES.length) + THINKING_FRAMES.length) % THINKING_FRAMES.length];
    case "composing":
      return "Composing reply…";
    case "tool":
      return `Running ${activity.name}…`;
  }
}