/**
 * Provider-agnostic streaming primitives shared by every streaming adapter.
 *
 * Two things live here because they are the genuinely hard, provider-specific
 * parts of streaming and would otherwise be duplicated per adapter:
 *
 *  1. `iterSse` — a correct Server-Sent-Events reader. It handles chunk
 *     boundaries that split a frame across reads, `:` keep-alive comments,
 *     `event:` names, multi-line `data:` payloads, and the `[DONE]` sentinel.
 *  2. `ToolCallAccumulator` — reassembles tool-call arguments, which arrive as
 *     arbitrary fragments of a JSON string and must be buffered until complete.
 *
 * Adapters only translate their own wire vocabulary into `ModelEvent`s.
 */
import type { ToolCall } from "../agent/types.js";

/** One decoded SSE frame. `event` is present for named events (Anthropic). */
export interface SseFrame {
  readonly event?: string;
  readonly data: string;
}

/** OpenAI-style terminator. */
export const SSE_DONE = "[DONE]";

/** True when a frame's payload is the stream terminator. */
export function isDoneFrame(data: string): boolean {
  return data.trim() === SSE_DONE;
}

/**
 * Iterate Server-Sent-Events frames from a `ReadableStream`.
 *
 * Frames are dispatched on a blank line per the SSE spec. As a pragmatic
 * concession to providers that omit the trailing blank line before `[DONE]`,
 * a `data:` line equal to `[DONE]` also dispatches immediately and then ends
 * the iteration.
 *
 * The stream is cancelled when `signal` aborts, which releases the underlying
 * HTTP connection.
 */
export async function* iterSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const dispatch = (): SseFrame | null => {
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    dataLines = [];
    const frame: SseFrame = eventName === undefined ? { data } : { event: eventName, data };
    eventName = undefined;
    return frame;
  };

  try {
    for (;;) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt: number;
      while ((newlineAt = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineAt).replace(/\r$/, "");
        buffer = buffer.slice(newlineAt + 1);

        // Blank line = end of frame.
        if (line === "") {
          const frame = dispatch();
          if (frame) yield frame;
          continue;
        }
        // `:` prefix is a comment / keep-alive heartbeat.
        if (line.startsWith(":")) continue;

        const colonAt = line.indexOf(":");
        const field = colonAt === -1 ? line : line.slice(0, colonAt);
        let fieldValue = colonAt === -1 ? "" : line.slice(colonAt + 1);
        if (fieldValue.startsWith(" ")) fieldValue = fieldValue.slice(1);

        if (field === "event") {
          eventName = fieldValue;
        } else if (field === "data") {
          dataLines.push(fieldValue);
          // Terminate early on [DONE] — some providers skip the final blank line.
          if (isDoneFrame(fieldValue)) {
            const frame = dispatch();
            if (frame) yield frame;
            return;
          }
        }
        // `id:` and `retry:` fields are accepted and ignored.
      }
    }

    // Flush any trailing partial data at EOF.
    buffer += decoder.decode();
    if (buffer.trim()) {
      const lastLine = buffer.replace(/\r$/, "");
      if (lastLine.startsWith("data:")) {
        dataLines.push(lastLine.slice(5).replace(/^ /, ""));
      }
    }
    const tail = dispatch();
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released after cancel(); harmless.
    }
  }
}

// ---------------------------------------------------------------------------
// Tool-call reassembly
// ---------------------------------------------------------------------------

interface PartialToolCall {
  id: string;
  name: string;
  /** Raw JSON text, accumulated across fragments. */
  args: string;
}

/**
 * Reassembles streamed tool calls.
 *
 * Providers stream tool calls by index: the id and name arrive once, then the
 * JSON `arguments` string arrives in fragments split at arbitrary byte offsets.
 * Fragments must therefore be concatenated verbatim and only parsed once the
 * stream ends.
 */
export class ToolCallAccumulator {
  private readonly byIndex = new Map<number, PartialToolCall>();
  private readonly order: number[] = [];
  private readonly started = new Set<number>();

  /**
   * Record a fragment.
   *
   * @returns the stable call id, and whether this is the first fragment seen
   *          for this index (so callers emit `tool_call_start` exactly once).
   */
  add(
    index: number,
    parts: { id?: string; name?: string; args?: string },
  ): { id: string; isNew: boolean } {
    let entry = this.byIndex.get(index);
    if (!entry) {
      entry = {
        // Synthesise a stable id when the provider omits one.
        id: parts.id && parts.id.length > 0 ? parts.id : `call_${index}`,
        name: parts.name ?? "unknown",
        args: "",
      };
      this.byIndex.set(index, entry);
      this.order.push(index);
    }
    if (parts.id && parts.id.length > 0) entry.id = parts.id;
    if (parts.name && parts.name.length > 0) entry.name = parts.name;
    if (parts.args) entry.args += parts.args;

    const isNew = !this.started.has(index);
    this.started.add(index);
    return { id: entry.id, isNew };
  }

  /** Parse the buffered arguments and return complete tool calls. */
  finish(): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const index of this.order) {
      const entry = this.byIndex.get(index);
      if (!entry) continue;
      calls.push({
        id: entry.id,
        name: entry.name as ToolCall["name"],
        input: parseToolArguments(entry.args),
      });
    }
    return calls;
  }
}

/**
 * Parse accumulated tool-call arguments.
 *
 * Falls back to a marked raw payload rather than throwing: truncated or
 * malformed arguments should surface as visible tool input the model can react
 * to, not crash the whole run.
 */
export function parseToolArguments(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { _raw: raw, _parseError: true };
  }
}
