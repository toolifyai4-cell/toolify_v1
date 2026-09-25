/**
 * Timeout primitives shared by the agent loop and the streaming consumer.
 *
 * These live in their own module so `src/agent/stream-consumer.ts` can raise
 * the same `AgentTimeoutError` the loop's error classifier already understands,
 * without importing `loop.ts` (which would create a cycle).
 */
export class AgentTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "AgentTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Wrap a promise with a wall-clock timeout.
 *
 * When the timer fires first the caller sees an `AgentTimeoutError` whose
 * message names the timed-out operation; when the work finishes first the
 * timer is cleared and the result passes through untouched.
 */
export function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentTimeoutError(operation, timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
