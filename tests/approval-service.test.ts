import { describe, it, expect, beforeEach } from "vitest";
import { createApprovalService, type LegacyApprovalHandler } from "../src/safety/approval-service.js";
import type { ToolCall, RiskTier } from "../src/agent/types.js";
import type { ApprovalContext, ApprovalDecision } from "../src/safety/approval-service.js";

describe("ApprovalService", () => {
  const mockCall: ToolCall = {
    id: "call_1",
    name: "write_file",
    input: { path: "test.txt", content: "hello" },
  };

  const mockContext: ApprovalContext = {
    riskTier: "write" as RiskTier,
    reason: "writing to workspace",
    workspace: "/tmp/workspace",
  };

  describe("createApprovalService — adapter", () => {
    it("wraps a legacy handler and maps scope correctly", async () => {
      const handler: LegacyApprovalHandler = {
        request: async (_call, reason) => ({ approved: true, scope: "session" }),
      };
      const svc = createApprovalService(handler);
      const decision: ApprovalDecision = await svc.request(mockCall, mockContext);
      expect(decision.approved).toBe(true);
      expect(decision.scope).toBe("session");
    });

    it("maps 'once' scope", async () => {
      const handler: LegacyApprovalHandler = {
        request: async () => ({ approved: true, scope: "once" }),
      };
      const svc = createApprovalService(handler);
      const decision = await svc.request(mockCall, mockContext);
      expect(decision.approved).toBe(true);
      expect(decision.scope).toBe("once");
    });

    it("passes through denied decisions", async () => {
      const handler: LegacyApprovalHandler = {
        request: async () => ({ approved: false }),
      };
      const svc = createApprovalService(handler);
      const decision = await svc.request(mockCall, mockContext);
      expect(decision.approved).toBe(false);
    });

    it("includes reason in denial", async () => {
      const handler: LegacyApprovalHandler = {
        request: async () => ({ approved: false }),
      };
      const svc = createApprovalService(handler);
      const decision = await svc.request(mockCall, mockContext);
      expect(decision.reason).toBe(mockContext.reason);
    });

    it("passes the reason from context to the legacy handler", async () => {
      let receivedReason: string | undefined;
      const handler: LegacyApprovalHandler = {
        request: async (_call, reason) => {
          receivedReason = reason;
          return { approved: true, scope: "session" };
        },
      };
      const svc = createApprovalService(handler);
      await svc.request(mockCall, { ...mockContext, reason: "custom reason" });
      expect(receivedReason).toBe("custom reason");
    });

    it("does not include reason on approval", async () => {
      const handler: LegacyApprovalHandler = {
        request: async () => ({ approved: true, scope: "session" }),
      };
      const svc = createApprovalService(handler);
      const decision = await svc.request(mockCall, mockContext);
      expect(decision.reason).toBeUndefined();
    });
  });
});
