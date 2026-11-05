import type { ApprovalService } from "./types";

/** Minimal approval service that always approves once.
 *  Replace with a VS Code‑prompt based implementation or a policy engine.
 */
export class SimpleApprovalService implements ApprovalService {
  async request(
    _call: {
      name: string;
      input: Record<string, unknown>;
    },
    _reason: string
  ): Promise<{ approved: boolean; scope?: "once" | "session" }> {
    // For now we auto‑approve; real usage should ask the user.
    return { approved: true, scope: "once" };
  }
}