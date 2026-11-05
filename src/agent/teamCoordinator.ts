/**
 * Team coordinator for Toolify – multi‑agent round‑robin mode.
 * Delegates a goal to specialist agents, each with its own model and tool set.
 * The coordinator iterates over specialists, persists checkpoints, and stops
 * when a "finish" keyword appears, a max iteration count is reached, or an
 * error occurs.
 */
import type { ModelAdapter, ChatResponse } from "../models/types";
import type { ToolSchema } from "../tools/tool";
import type { SimpleApprovalService } from "../safety/approval-service";
import type { CheckpointRepository } from "../persistence/checkpoint-repository";
import type { SessionRepository } from "../persistence/session-repository";
import type { HookRegistry } from "../sdk/hooks";

export interface TeamAgentConfig {
  name: string;
  provider: ModelAdapter;
  tools: readonly ToolSchema[];
  modelId?: string;
}

export interface TeamConfig {
  name: string;
  agents: TeamAgentConfig[];
}

export interface TeamState {
  name: string;
  iteration: number;
  lastPrompt?: string;
  payload?: Record<string, unknown>;
}

export class TeamCoordinator {
  private config: TeamConfig;
  private approval: SimpleApprovalService;
  private checkpointRepo: CheckpointRepository;
  private sessionRepo: SessionRepository;
  private hooks: HookRegistry;
  private state: TeamState;

  constructor(
    config: TeamConfig,
    deps: {
      approval: SimpleApprovalService;
      checkpointRepo: CheckpointRepository;
      sessionRepo?: SessionRepository;
      hooks?: HookRegistry;
    }
  ) {
    this.config = config;
    this.approval = deps.approval;
    this.checkpointRepo = deps.checkpointRepo;
    this.sessionRepo = deps.sessionRepo ?? ({} as any);
    this.hooks = deps.hooks ?? new (await import("../sdk/hooks")).HookRegistry();
    this.state = {
      name: config.name,
      iteration: 0,
    };
  }

  /** Execute one specialist round and return its response + finish flag. */
  private async runSpecialist(
    specialist: TeamAgentConfig,
    prompt: string
  ): Promise<{ response: ChatResponse; finished: boolean }> {
    this.hooks.emitAgentStart(prompt);

    const messages = [{ role: "user", content: prompt }];
    const result = await specialist.provider.chat({
      messages,
      tools: specialist.tools,
    });

    const response = result as ChatResponse;

    // Simplified tool‑hook emission
    if (response.text) {
      this.hooks.emitToolSuccess({
        toolName: specialist.name,
        callId: "0",
        output: response.text,
      });
    } else if (response.isError) {
      this.hooks.emitToolError({
        toolName: specialist.name,
        callId: "0",
        error: response.text || "unknown error",
      });
    }

    const finished =
      response.text && /(finish|done|complete)/i.test(response.text);

    return { response, finished };
  }

  /** Persist the current TeamState to the checkpoint repository. */
  private async persistState(): Promise<void> {
    try {
      await this.checkpointRepo.save({
        team: this.config.name,
        iteration: this.state.iteration,
        payload: this.state,
      });
    } catch {
      // swallow errors – the in‑memory state remains valid.
    }
  }

  /** Run the coordinator until a finish signal, max iterations, or error. */
  async run(prompt: string): Promise<ChatResponse> {
    this.state.iteration = 0;
    await this.persistState();

    let currentPrompt = prompt;
    const maxIterations = 100;

    while (this.state.iteration < maxIterations) {
      for (const specialist of this.config.agents) {
        if (this.state.iteration >= maxIterations) break;

        this.state.iteration++;
        await this.persistState();

        console.log(
          `▶️ Specialist "${specialist.name}" (iteration ${this.state.iteration})`
        );

        const { response, finished } = await this.runSpecialist(
          specialist,
          currentPrompt
        );

        // Update payload for possible later inspection
        this.state.payload = {
          lastPrompt: currentPrompt,
          specialist: specialist.name,
          response: response.text,
        };
        await this.persistState();

        if (finished) {
          console.log(`✅ Specialist "${specialist.name}" finished.`);
          return response;
        }

        // Feed the specialist's output back into the next round.
        currentPrompt = `Previous specialist "${specialist.name}" said: ${response.text ?? ""}. Continue working on the original request.`;
      }
    }

    console.log(
      `⚠️ Team "${this.config.name}" reached max iterations without a finish signal.`
    );
    // Return a minimal response so callers aren't left hanging.
    return {
      text: "",
      toolCalls: [],
      usage: {},
      model: "team-coordinator",
    };
  }
}

/** Factory – convenient way to create a TeamCoordinator. */
export function createTeamCoordinator(
  config: TeamConfig,
  deps: {
    approval: SimpleApprovalService;
    checkpointRepo: CheckpointRepository;
    sessionRepo?: SessionRepository;
    hooks?: HookRegistry;
  }
): TeamCoordinator {
  return new TeamCoordinator(config, deps);
}