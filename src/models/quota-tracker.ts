/**
 * Dynamic token quota tracking, rate-limit header parsing, and JSON persistence.
 *
 * Provider response headers like `x-ratelimit-remaining-tokens` are parsed on
 * every successful turn and persisted to `~/.toolify/quota.json` so the picker
 * and status bar can display live remaining-budget badges.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface QuotaState {
  providerId: string;
  modelId: string;
  remainingTokens?: number;
  limitTokens?: number;
  remainingRequests?: number;
  resetTime?: string;
  isExhausted: boolean;
}

export interface QuotaTracker {
  updateQuotaFromHeaders(providerId: string, modelId: string, headers: Record<string, string>): void;
  getQuota(providerId: string, modelId: string): QuotaState | null;
  exportSnapshot(): Record<string, QuotaState>;
}

const QUOTA_DIR = ".toolify";
const QUOTA_FILE = "quota.json";

function quotaDir(): string { return resolve(homedir(), QUOTA_DIR); }
function quotaPath(): string { return resolve(homedir(), QUOTA_DIR, QUOTA_FILE); }

function parsePositiveInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function resetRelative(epochSec: number | undefined): string | undefined {
  if (epochSec === undefined || !Number.isFinite(epochSec)) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(epochSec - now, 0);
  if (remaining <= 0) return "now";
  if (remaining < 60) return `${remaining}s`;
  if (remaining < 3600) return `${Math.round(remaining / 60)}m`;
  return `${Math.round(remaining / 3600)}h`;
}

function decodeHeaderMap(raw: Headers | Record<string, string>): Record<string, string> {
  if (raw instanceof Headers) {
    const out: Record<string, string> = {};
    raw.forEach((v, k) => { out[k] = v; });
    return out;
  }
  return raw;
}

function makeKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

class FileBackedQuotaTracker implements QuotaTracker {
  private map: Map<string, QuotaState> = new Map();

  constructor() { this.load(); }

  private load(): void {
    const path = quotaPath();
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as Record<string, QuotaState> | null;
      if (parsed) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "object" && v !== null && typeof (v as any).providerId === "string") {
            this.map.set(k, v as QuotaState);
          }
        }
      }
    } catch { /* corrupt file — start fresh */ }
  }

  private persist(): void {
    const dir = quotaDir();
    if (!existsSync(dir)) {
      try { require("node:fs").mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
    }
    try {
      writeFile(quotaPath(), JSON.stringify(this.exportSnapshot(), null, 2), { mode: 0o600 }).catch(() => { /* ignore */ });
    } catch { /* best-effort */ }
  }



  updateQuotaFromHeaders(providerId: string, modelId: string, headers: Record<string, string>): void {
    const lowered = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );

    const limitTokens = parsePositiveInt(lowered["x-ratelimit-limit-tokens"]);
    const remainingTokens = parsePositiveInt(lowered["x-ratelimit-remaining-tokens"]);
    const resetTokens = parsePositiveInt(lowered["x-ratelimit-reset-tokens"]);
    const remainingRequests = parsePositiveInt(lowered["x-ratelimit-remaining-requests"]);
    const resetRequests = parsePositiveInt(lowered["x-ratelimit-reset-requests"]);

    const resetTime: string | undefined = resetRelative(resetTokens || resetRequests);

    const isExhausted = remainingTokens === 0
      || remainingRequests === 0
      || (limitTokens !== undefined && remainingTokens !== undefined && limitTokens > 0 && remainingTokens >= limitTokens)
      || false;

    this.map.set(makeKey(providerId, modelId), {
      providerId,
      modelId,
      remainingTokens: remainingTokens !== undefined ? remainingTokens : undefined,
      limitTokens: limitTokens !== undefined ? limitTokens : undefined,
      remainingRequests: remainingRequests !== undefined ? remainingRequests : undefined,
      resetTime,
      isExhausted,
    });
    this.persist();
  }

  getQuota(providerId: string, modelId: string): QuotaState | null {
    return this.map.get(makeKey(providerId, modelId)) ?? null;
  }

  exportSnapshot(): Record<string, QuotaState> {
    const out: Record<string, QuotaState> = {};
    this.map.forEach((v, k) => { out[k] = v; });
    return out;
  }
}

let tracker: QuotaTracker | null = null;

export function resetQuotaTracker(): void { tracker = null; }

export function getQuotaTracker(): QuotaTracker {
  if (!tracker) tracker = new FileBackedQuotaTracker();
  return tracker;
}

export function updateQuotaFromHeaders(providerId: string, modelId: string, headers: Record<string, string> | Headers): void {
  getQuotaTracker().updateQuotaFromHeaders(providerId, modelId, decodeHeaderMap(headers));
}

export function getQuota(providerId: string, modelId: string): QuotaState | null {
  return getQuotaTracker().getQuota(providerId, modelId);
}

export function quotaSnapshot(): Record<string, QuotaState> {
  return getQuotaTracker().exportSnapshot();
}