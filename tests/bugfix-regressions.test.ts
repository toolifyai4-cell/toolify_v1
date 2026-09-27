/**
 * Tests for the bug fixes found during the live streaming smoke test.
 *
 * Each block corresponds to a bug reproduced in a real TOOLIFY session.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizePattern, globTool } from "../src/tools/search-tools.js";
import { PathGuard } from "../src/tools/fs-tools.js";
import { CostMeter } from "../src/agent/meter.js";
import { resolvePricing, isPricingKnown } from "../src/models/pricing.js";

/**
 * Local copy of the chat message shape.
 *
 * Deliberately NOT imported from `ChatUI.tsx`: that module pulls in Ink, and
 * importing it here would drag the whole terminal UI into a pure-logic unit
 * test. Keep this in sync if `ChatMessage` changes.
 */
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: boolean;
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

async function withWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await mkdtemp(join(tmpdir(), "toolify-fix-"));
  try {
    await fn(ws);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

describe("Bug: glob treated quoted patterns as literals", () => {
  it("strips symmetric wrapping double quotes", () => {
    expect(normalizePattern('"**/*.java"')).toBe("**/*.java");
  });

  it("strips symmetric wrapping single quotes", () => {
    expect(normalizePattern("'*.ts'")).toBe("*.ts");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePattern("  *.ts  ")).toBe("*.ts");
  });

  it("strips one level of nested quotes", () => {
    expect(normalizePattern('"\'*.ts\'"')).toBe("*.ts");
  });

  it("leaves an unquoted pattern untouched", () => {
    expect(normalizePattern("**/*.java")).toBe("**/*.java");
  });

  it("leaves internal quotes alone (only symmetric wraps are removed)", () => {
    expect(normalizePattern('say"hello"')).toBe('say"hello"');
  });

  it("handles a lone quote character without looping or throwing", () => {
    expect(normalizePattern('"')).toBe('"');
  });

  it("actually matches files when the model wraps the pattern in quotes", async () => {
    await withWorkspace(async (ws) => {
      await mkdir(join(ws, "src"), { recursive: true });
      await writeFile(join(ws, "src", "Main.java"), "class Main {}");

      const guard = new PathGuard(ws);
      // Quoted pattern: previously returned "No files matched".
      const quoted = await globTool(guard, { pattern: '"**/*.java"' });
      expect(quoted).toContain("Main.java");

      // Unquoted must behave identically.
      const plain = await globTool(guard, { pattern: "**/*.java" });
      expect(plain).toBe(quoted);
    });
  });
});

describe("Bug: usage was synced before the run, so the UI showed Tokens: 0", () => {
  it("CostMeter accumulates usage so a post-run sync can copy it", () => {
    const meter = new CostMeter({ inputPerM: 1e-6, outputPerM: 2e-6 });
    meter.add({ inputTokens: 1000, outputTokens: 500 });
    expect(meter.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(meter.costUsd).toBeGreaterThan(0);
  });

  it("a fresh container meter starts at zero, proving why pre-run sync failed", () => {
    // The container builds a NEW meter each turn, and syncing it BEFORE
    // loop.run() copies {0,0}. A post-run sync copies real usage.
    const beforeRun = new CostMeter({ inputPerM: 1e-6, outputPerM: 2e-6 });
    expect(beforeRun.usage).toEqual({ inputTokens: 0, outputTokens: 0 });

    // Simulating the persistent meter + a post-run sync across two turns.
    const persistent = new CostMeter({ inputPerM: 1e-6, outputPerM: 2e-6 });
    for (const n of [1079, 1091]) {
      const turn = new CostMeter({ inputPerM: 1e-6, outputPerM: 2e-6 });
      turn.add({ inputTokens: n, outputTokens: 10 });
      persistent.add(turn.usage);
    }
    expect(persistent.usage.inputTokens).toBe(2170);
  });
});

describe("Bug: orphaned thinking placeholders left permanent ... in the UI", () => {
  /** Mirrors the cleanup applied in chat.tsx's finally block. */
  const cleanup = (prev: ChatMessage[]): ChatMessage[] => {
    const cleaned = prev.filter(
      (m) => !(m.role === "assistant" && m.thinking && !m.content),
    );
    return cleaned.length === prev.length ? prev : cleaned;
  };

  it("removes a trailing empty thinking placeholder", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", thinking: true },
    ];
    expect(cleanup(msgs)).toHaveLength(1);
  });

  it("removes a placeholder stranded in the middle by a later message", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", thinking: true },
      { role: "assistant", content: "done" },
    ];
    const out = cleanup(msgs);
    expect(out).toHaveLength(2);
    expect(out.some((m) => m.thinking)).toBe(false);
  });

  it("removes MULTIPLE accumulated placeholders (the observed symptom)", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "", thinking: true },
      { role: "user", content: "b" },
      { role: "assistant", content: "", thinking: true },
      { role: "assistant", content: "ok" },
    ];
    const out = cleanup(msgs);
    expect(out.filter((m) => m.thinking)).toHaveLength(0);
    expect(out).toHaveLength(3);
  });

  it("keeps a placeholder that already has content", () => {
    const msgs: ChatMessage[] = [
      { role: "assistant", content: "partial", thinking: true },
    ];
    expect(cleanup(msgs)).toHaveLength(1);
  });

  it("leaves normal messages untouched (identity preserved)", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(cleanup(msgs)).toBe(msgs);
  });
});

describe("Pricing: unknown models must not read as free", () => {
  it("returns explicit config pricing when provided", () => {
    const p = resolvePricing("anything", { inputPerM: 1, outputPerM: 2 });
    expect(p.inputPerM).toBe(1);
    expect(isPricingKnown(p)).toBe(true);
  });

  it("resolves a known model from the estimate table", () => {
    const p = resolvePricing("gpt-4o");
    expect(p.inputPerM).toBeGreaterThan(0);
    expect(isPricingKnown(p)).toBe(true);
  });

  it("marks an unknown model as unknown rather than silently free", () => {
    const p = resolvePricing("qwen/qwen3.8-omni-flash");
    expect(isPricingKnown(p)).toBe(false);
    expect(p.isEstimate).toBe(true);
  });

  it("tries the trailing segment of a gateway-prefixed id", () => {
    expect(resolvePricing("openrouter/gpt-4o").inputPerM).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(resolvePricing("GPT-4O").inputPerM).toBeGreaterThan(0);
  });

  it("exposes pricingUnknown on the meter for UI display", () => {
    expect(new CostMeter(resolvePricing("qwen/qwen3.8-omni-flash")).pricingUnknown).toBe(true);
    expect(new CostMeter(resolvePricing("gpt-4o")).pricingUnknown).toBe(false);
  });
});
