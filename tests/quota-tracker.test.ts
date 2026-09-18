import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  updateQuotaFromHeaders,
  getQuota,
  resetQuotaTracker,
  quotaSnapshot,
} from "../src/models/quota-tracker.js";
import { readFile, unlink } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const QUOTA_FILE = resolve(homedir(), ".toolify", "quota.json");

function nukeQuotaFile(): void {
  if (existsSync(QUOTA_FILE)) {
    try { rmSync(QUOTA_FILE, { force: true }); } catch { /* ignore */ }
  }
}

describe("quota-tracker", () => {
  beforeEach(() => {
    resetQuotaTracker();
    nukeQuotaFile();
  });

  afterEach(() => {
    nukeQuotaFile();
  });

  it("extracts remaining/limit tokens from headers", () => {
    updateQuotaFromHeaders("gemini", "gemini-2.5-flash", {
      "x-ratelimit-remaining-tokens": "148000",
      "x-ratelimit-limit-tokens": "150000",
    });
    const q = getQuota("gemini", "gemini-2.5-flash");
    expect(q).not.toBeNull();
    expect(q!.remainingTokens).toBe(148000);
    expect(q!.limitTokens).toBe(150000);
    expect(q!.isExhausted).toBe(false);
  });

  it("marks exhausted when remaining tokens are 0", () => {
    updateQuotaFromHeaders("openai", "gpt-4o", {
      "x-ratelimit-remaining-tokens": "0",
    });
    const q = getQuota("openai", "gpt-4o");
    expect(q!.isExhausted).toBe(true);
    expect(q!.remainingTokens).toBe(0);
  });

  it("marks exhausted when remaining requests are 0", () => {
    updateQuotaFromHeaders("openrouter", "claude-3.5", {
      "x-ratelimit-remaining-requests": "0",
    });
    const q = getQuota("openrouter", "claude-3.5");
    expect(q!.isExhausted).toBe(true);
    expect(q!.remainingRequests).toBe(0);
  });

  it("persists quota to quota.json and re-reads it", async () => {
    updateQuotaFromHeaders("gemini", "gemini-2.5-flash", {
      "x-ratelimit-remaining-tokens": "5000",
      "x-ratelimit-limit-tokens": "10000",
    });
    await new Promise((r) => setTimeout(r, 100));
    const raw = await readFile(QUOTA_FILE, "utf8");
    const persisted = JSON.parse(raw);
    expect(persisted["gemini::gemini-2.5-flash"]).toBeDefined();
    expect(persisted["gemini::gemini-2.5-flash"].remainingTokens).toBe(5000);

    resetQuotaTracker();
    const q = getQuota("gemini", "gemini-2.5-flash");
    expect(q).not.toBeNull();
    expect(q!.remainingTokens).toBe(5000);
    expect(q!.limitTokens).toBe(10000);
  });

  it("returns null for unknown provider/model", () => {
    resetQuotaTracker();
    expect(getQuota("unknown", "some-model")).toBeNull();
  });

  it("overwrites previous quota for same provider/model", () => {
    updateQuotaFromHeaders("gemini", "gemini-2.5-flash", {
      "x-ratelimit-remaining-tokens": "90000",
      "x-ratelimit-limit-tokens": "100000",
    });
    updateQuotaFromHeaders("gemini", "gemini-2.5-flash", {
      "x-ratelimit-remaining-tokens": "5000",
      "x-ratelimit-limit-tokens": "10000",
      "x-ratelimit-reset-tokens": "1762500000",
    });
    const q = getQuota("gemini", "gemini-2.5-flash");
    expect(q!.remainingTokens).toBe(5000);
    expect(q!.limitTokens).toBe(10000);
    expect(typeof q!.resetTime).toBe("string");
  });

  it("handles case-insensitive headers", () => {
    updateQuotaFromHeaders("gemini", "gemini-2.5-flash", {
      "X-RATELIMIT-REMAINING-TOKENS": "4200",
      "x-ratelimit-limit-tokens": "5000",
    });
    const q = getQuota("gemini", "gemini-2.5-flash");
    expect(q!.remainingTokens).toBe(4200);
    expect(q!.limitTokens).toBe(5000);
  });

  it("provides quotaSnapshot with all tracked providers", () => {
    updateQuotaFromHeaders("gemini", "gemini-2.5-flash", {
      "x-ratelimit-remaining-tokens": "100",
      "x-ratelimit-limit-tokens": "200",
    });
    updateQuotaFromHeaders("openai", "gpt-4o", {
      "x-ratelimit-remaining-tokens": "0",
      "x-ratelimit-limit-tokens": "1000000",
    });
    const snap = quotaSnapshot();
    expect(Object.keys(snap)).toContain("gemini::gemini-2.5-flash");
    expect(Object.keys(snap)).toContain("openai::gpt-4o");
    expect(snap["openai::gpt-4o"].isExhausted).toBe(true);
  });
});
