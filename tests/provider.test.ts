import { describe, it, expect } from "vitest";
import { createModelProvider } from "../src/providers/provider.js";
import { MockModelAdapter } from "../src/models/mock.js";
import type { ChatRequest } from "../src/agent/types.js";

describe("ModelProvider contract", () => {
  const adapter = new MockModelAdapter([{ text: "Hello", finishReason: "stop" }]);

  describe("createModelProvider", () => {
    it("wraps an adapter as a ModelProvider", () => {
      const provider = createModelProvider(adapter);
      expect(provider.id).toBe("mock");
      expect(provider.modelId).toBe("mock-scripted");
      expect(provider.capabilities.streaming).toBe(false);
      expect(provider.capabilities.tools).toBe(true);
    });

    it("allows capabilities override", () => {
      const provider = createModelProvider(adapter, {
        capabilities: { streaming: true, vision: true },
      });
      expect(provider.capabilities.streaming).toBe(true);
      expect(provider.capabilities.vision).toBe(true);
      expect(provider.capabilities.tools).toBe(true);
    });

    it("delegates chat() to the adapter", async () => {
      const provider = createModelProvider(adapter);
      const req: ChatRequest = {
        system: "you are a bot",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      };
      const resp = await provider.chat(req);
      expect(resp.text).toBe("Hello");
      expect(resp.finishReason).toBe("stop");
      expect(resp.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect(provider.stream).toBeUndefined();
    });
  });
});
