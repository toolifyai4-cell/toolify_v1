/**
 * Consumes a provider's `ModelEvent` stream and assembles a `ChatResponse`.
 *
 * This is what lets the agent loop treat streaming and non-streaming providers
 * identically: both end up producing a single `ChatResponse`, so the rest of
 * the loop is unchanged.
 *
 * ## Why idle timeout instead of total duration
 *
 * A non-streaming call can be bounded by a single wall-clock deadline: the
 * whole response must arrive within N ms. That is wrong for a stream. A long
 * generation is legitimate — a 60-second answer is not a hang. The only real
 * failure mode is the stream going *silent*, so the deadline applies
 * **per chunk**: if no event arrives within `idleTimeoutMs`, the stream is
 * stuck and we abort.
 */
import type { ChatRequest, ChatResponse, FinishReason, ModelEvent, ToolCall, Usage } from "./types.js";
import type { ModelProvider } from "../providers/provider.js";
import { AgentTimeoutError, withTimeout } from "./timeouts.js";

export interface StreamConsumeCallbacks {
  /** Called for each text delta, in arrival order. */
  onTextDelta?: (delta: string) => void;
  /** Called for each reasoning/thinking delta (Anthropic extended thinking, DeepSeek). */
  onReasoningDelta?: (delta: string) => void;
  /** Called once, immediately before the first text delta. */
  onFirstToken?: () => void;
}

export interface StreamConsumeOptions extends StreamConsumeCallbacks {
  readonly provider: ModelProvider;
  readonly request: ChatRequest;
  /** Max time to wait between any two events before declaring the stream stuck. */
  readonly idleTimeoutMs: number;
  /** Caller cancellation (Esc / Ctrl+C). */
  readonly signal?: AbortSignal;
}

/**
 * Drain `provider.stream()` into a single `ChatResponse`.
 *
 * A locally-owned `AbortController` is derived from the caller's signal so the
 * HTTP connection is torn down on cancellation or on an idle timeout — without
 * aborting the caller's own controller.
 */
export async function consumeProviderStream(
  opts: StreamConsumeOptions,
): Promise<ChatResponse> {
  const { provider, request, idleTimeoutMs } = opts;
  const streamFn = provider.stream;
  if (!streamFn) {
    throw new Error(
      `Provider "${provider.id}" advertised streaming but does not implement stream().`,
    );
  }

  // Own controller so we can cancel the request without touching the caller's.
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: FinishReason = "stop";
  let sawFirstToken = false;

  try {
    const iterable = streamFn.call(provider, { ...request, signal: controller.signal });
    const iterator = iterable[Symbol.asyncIterator]();

    for (;;) {
      if (controller.signal.aborted) break;

      // Per-chunk deadline. The losing promise is guarded against unhandled
      // rejection because aborting the request will reject it.
      const pending = iterator.next();
      pending.catch(() => undefined);

      let next;
      try {
        next = await withTimeout(
          pending,
          idleTimeoutMs,
          `model stream idle (${provider.id})`,
        );
      } catch (err) {
        // Abort the HTTP request so the socket does not linger.
        controller.abort();
        void iterator.return?.(undefined).catch(() => undefined);
        throw err;
      }

      if (next.done === true) break;

      // Only the fulfilled branch of IteratorResult carries an event.
      const event = next.value;
      if (event === undefined) break;
      switch (event.type) {
        case "text_delta":
          if (!sawFirstToken) {
            sawFirstToken = true;
            opts.onFirstToken?.();
          }
          text += event.text;
          opts.onTextDelta?.(event.text);
          break;
        case "reasoning_delta":
          opts.onReasoningDelta?.(event.text);
          break;
        case "tool_call_start":
          // Informational; the assembled call arrives via tool_call_complete.
          break;
        case "tool_call_delta":
          break;
        case "tool_call_complete":
          toolCalls.push(event.call);
          break;
        case "usage":
          usage = event.usage;
          break;
        case "completed":
          finishReason = event.finishReason;
          break;
        case "error":
          controller.abort();
          throw new Error(event.error.message);
      }
    }
  } finally {
    opts.signal?.removeEventListener("abort", onCallerAbort);
    if (!controller.signal.aborted) controller.abort();
  }

  // A stream that produced tool calls but reported a plain "stop" still needs
  // to drive another loop iteration.
  if (toolCalls.length > 0 && finishReason === "stop") {
    finishReason = "tool_use";
  }

  return { text, toolCalls, usage, finishReason, providerId: provider.id };
}

/** Re-exported so callers can narrow timeout failures without a deep import. */
export { AgentTimeoutError };
