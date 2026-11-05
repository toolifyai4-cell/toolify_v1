/**
 * Minimal team coordinator for Toolify – enables multi‑agent mode where a
 * coordinator delegates a goal to specialist agents, each with its own model
 * and tool set.  Persistence is left as a stub; replace with a real store if
 * needed.
 */
export interface TeamAgentConfig {
  name: string;
  provider: any;
  tools: any[];
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
}

export class TeamCoordinator {
  private config: TeamConfig;
  private state: TeamState;

  constructor(config: TeamConfig, state?: TeamState) {
    this.config = config;
    this.state = state ?? { name: config.name, iteration: 0 };
  }

  async run(prompt: string): Promise<{ text: string }> {
    this.state.iteration++;
    // Placeholder: just return the prompt echoed.
    return { text: `Coordinator "${this.config.name}" received: ${prompt}` };
  }
}