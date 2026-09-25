/**
 * Provider contract — decouples the agent runtime from concrete model providers.
 *
 * This module defines the provider-neutral interfaces that every model adapter
 * must satisfy. The existing `ModelAdapter` (see `src/agent/types.ts`) continues
 * to work through a compatibility adapter (`createModelProvider`).
 */
import type {
  ChatRequest,
  ChatResponse,
  FinishReason,
  ModelEvent,
  ToolCall,
  ToolSchema,
  Usage,
  ModelAdapter,
  ModelPricing,
} from "../agent/types.js";

// Re-export the canonical message/event types so callers only need to import
// from the provider contract for everything model-related.
export type {
  ChatRequest,
  ChatResponse,
  FinishReason,
  ToolCall,
  ToolSchema,
  Usage,
} from "../agent/types.js";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Features a provider advertises as supported. */
export interface ProviderCapabilities {
  /** Whether `stream()` is available for incremental token delivery. */
  readonly streaming: boolean;
  /** Whether the provider supports structured tool/function calling. */
  readonly tools: boolean;
  /** Whether the provider can return reasoning/thinking tokens. */
  readonly reasoning?: boolean;
  /** Whether the provider accepts image / multimodal input. */
  readonly vision?: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Normalised error returned by a provider.
 *
 * Provider-specific error codes are mapped to a stable string so the agent
 * loop can classify failures without importing provider SDKs.
 */
export interface ProviderError {
  /** Stable machine-readable code, e.g. "auth", "rate_limit", "network", "parse". */
  readonly code: string;
  /** Human-readable message suitable for the user. */
  readonly message: string;
  /** HTTP status code, when applicable. */
  readonly status?: number;
  /** Whether the caller may legitimately retry the request. */
  readonly retryable: boolean;
  /** Originating provider id, when known. */
  readonly providerId?: string;
}

// ---------------------------------------------------------------------------
// Streaming events
// ---------------------------------------------------------------------------

/**
 * Normalised streaming event union.
 *
 * Re-exported from the canonical definition in `src/agent/types.ts`; this
 * alias exists so provider-focused code has one import site.
 *
 * Providers that only support non-streaming completion simply omit `stream()`
 * and return a `ChatResponse` from `chat()`.
 */
export type { ModelEvent } from "../agent/types.js";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Provider-neutral model interface.
 *
 * Every concrete provider adapter — OpenAI-compatible, Anthropic, Mock, etc. —
 * is wrapped to satisfy this interface. The runtime depends on `ModelProvider`,
 * never on the concrete adapter classes directly.
 */
export interface ModelProvider {
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<ModelEvent>;
}

// ---------------------------------------------------------------------------
// Compatibility adapter
// ---------------------------------------------------------------------------

/** Minimal shape of the existing ModelAdapter that the adapter needs. */
export interface ModelAdapterLike {
  readonly name: string;
  readonly modelId: string;
  readonly pricing: ModelPricing;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Optional; present on streaming adapters. */
  stream?(req: ChatRequest): AsyncIterable<ModelEvent>;
}

/**
 * Wrap an existing `ModelAdapter` (or any object implementing `ModelAdapterLike`)
 * as a `ModelProvider`.
 *
 * `stream()` is forwarded when the underlying adapter implements it, and
 * `capabilities.streaming` is derived from that rather than hard-coded — so
 * non-streaming adapters (notably `MockModelAdapter`) correctly report `false`
 * and the loop keeps using `chat()`.
 */
export function createModelProvider(
  adapter: ModelAdapterLike,
  options?: { capabilities?: Partial<ProviderCapabilities> },
): ModelProvider {
  const streaming = typeof adapter.stream === "function";
  const base: ProviderCapabilities = {
    streaming,
    tools: true,
    ...options?.capabilities,
  };

  const provider: ModelProvider = {
    id: adapter.name,
    modelId: adapter.modelId,
    capabilities: base,
    chat: (request: ChatRequest) => adapter.chat(request),
  };

  if (adapter.stream) {
    const streamFn = adapter.stream.bind(adapter);
    provider.stream = (request: ChatRequest) => streamFn(request);
  }

  return provider;
}

// Re-export ModelAdapter type for callers that still need it
export type { ModelAdapter, ModelPricing } from "../agent/types.js";
