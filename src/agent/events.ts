/**
 * Agent event bus — a minimal, framework-independent pub/sub abstraction.
 *
 * The bus is used to broadcast `AgentEvent`s to multiple subscribers (e.g.
 * session log, live UI, tests) without coupling to React, Ink, or the CLI.
 */
import type { AgentEvent } from "./types.js";

// Re-export so consumers only need to import from the events module.
export type { AgentEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Event bus interface
// ---------------------------------------------------------------------------

/**
 * Subscribe returns an unsubscribe function. Calling it removes the listener
 * so subsequent `emit` calls skip it.
 */
export interface AgentEventBus {
  subscribe(listener: (event: AgentEvent) => void): () => void;
  emit(event: AgentEvent): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * Synchronous, in-memory event bus.
 *
 * - Supports multiple subscribers.
 * - Preserves event order.
 * - Returns an unsubscribe function from `subscribe`.
 * - Does NOT import React, Ink, or CLI code.
 * - Listener exceptions are collected and re-thrown as an `AggregateError`
 *   after all listeners have been notified, so failures are observable and
 *   testable and no subscriber is silently skipped.
 */
export class InMemoryEventBus implements AgentEventBus {
  private listeners: Set<(event: AgentEvent) => void> = new Set();
  /** Last error observed (for test introspection). */
  private lastError: Error | null = null;

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AgentEvent): void {
    // Snapshot the set so listeners that unsubscribe during emit don't
    // affect iteration, and a throw from one listener still notifies the rest.
    const snapshot = [...this.listeners];
    const errors: Error[] = [];
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        errors.push(e);
        this.lastError = e;
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "One or more event bus listeners threw");
  }

  /** Returns the most recent listener error, or null. */
  getLastError(): Error | null {
    return this.lastError;
  }

  /** Number of active subscribers (for testing). */
  get subscriberCount(): number {
    return this.listeners.size;
  }
}

