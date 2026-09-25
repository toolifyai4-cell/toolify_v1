import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryEventBus } from "../src/agent/events.js";
import type { AgentEvent } from "../src/agent/types.js";

describe("InMemoryEventBus", () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  it("delivers events to subscribers", () => {
    const events: AgentEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const ev = { type: "error", message: "test", ts: 123 } as const;
    bus.emit(ev);
    expect(events).toEqual([ev]);
  });

  it("supports multiple subscribers", () => {
    const a: AgentEvent[] = [];
    const b: AgentEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    const ev = { type: "error", message: "multi", ts: 1 } as const;
    bus.emit(ev);
    expect(a).toEqual([ev]);
    expect(b).toEqual([ev]);
    expect(bus.subscriberCount).toBe(2);
  });

  it("unsubscribe removes the listener", () => {
    const events: AgentEvent[] = [];
    const unsub = bus.subscribe((e) => events.push(e));
    expect(bus.subscriberCount).toBe(1);
    unsub();
    expect(bus.subscriberCount).toBe(0);
    bus.emit({ type: "error", message: "x", ts: 1 } as const);
    expect(events).toEqual([]);
  });

  it("notifies all subscribers even if one throws, then re-throws", () => {
    const received: string[] = [];
    bus.subscribe(() => { received.push("ok1"); });
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe(() => { throw new Error("kaboom"); });
    bus.subscribe(() => { received.push("ok2"); });

    expect(() => {
      bus.emit({ type: "error", message: "test", ts: 1 } as const);
    }).toThrow(/One or more event bus listeners threw/);

    // Both non-throwing subscribers were notified
    expect(received).toEqual(["ok1", "ok2"]);
    expect(bus.getLastError()).toBeInstanceOf(Error);
    expect(bus.getLastError()?.message).toBe("kaboom");
  });

  it("re-throws single error directly (not wrapped in AggregateError)", () => {
    bus.subscribe(() => { throw new Error("single"); });
    expect(() => {
      bus.emit({ type: "error", message: "x", ts: 1 } as const);
    }).toThrow("single");
  });

  it("preserves event order across subscribers", () => {
    const order: string[] = [];
    bus.subscribe(() => order.push("first"));
    bus.subscribe(() => order.push("second"));
    bus.subscribe(() => order.push("third"));
    bus.emit({ type: "error", message: "ord", ts: 1 } as const);
    expect(order).toEqual(["first", "second", "third"]);
  });
});


import { InMemoryEventBus } from "../src/agent/events.js";
import type { AgentEvent } from "../src/agent/types.js";

describe("InMemoryEventBus", () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  it("delivers events to subscribers", () => {
    const events: AgentEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const ev = { type: "error", message: "test", ts: 123 } as const;
    bus.emit(ev);
    expect(events).toEqual([ev]);
  });

  it("supports multiple subscribers", () => {
    const a: AgentEvent[] = [];
    const b: AgentEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    const ev = { type: "error", message: "multi", ts: 1 } as const;
    bus.emit(ev);
    expect(a).toEqual([ev]);
    expect(b).toEqual([ev]);
    expect(bus.subscriberCount).toBe(2);
  });

  it("unsubscribe removes the listener", () => {
    const events: AgentEvent[] = [];
    const unsub = bus.subscribe((e) => events.push(e));
    expect(bus.subscriberCount).toBe(1);
    unsub();
    expect(bus.subscriberCount).toBe(0);
    bus.emit({ type: "error", message: "x", ts: 1 } as const);
    expect(events).toEqual([]);
  });

          it("notifies all subscribers even if one throws, then re-throws", () => {
    const received: string[] = [];
    bus.subscribe(() => { received.push("ok1"); });
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe(() => { throw new Error("kaboom"); });
    bus.subscribe(() => { received.push("ok2"); });

    expect(() => {
      bus.emit({ type: "error", message: "test", ts: 1 } as const);
    }).toThrow(/One or more event bus listeners threw/);

    // Both non-throwing subscribers were notified
    expect(received).toEqual(["ok1", "ok2"]);
    expect(bus.getLastError()).toBeInstanceOf(Error);
    expect(bus.getLastError()?.message).toBe("kaboom");
  });

  it("re-throws single error directly (not wrapped in AggregateError)", () => {
    bus.subscribe(() => { throw new Error("single"); });
    expect(() => {
      bus.emit({ type: "error", message: "x", ts: 1 } as const);
    }).toThrow("single");
  });

  it("preserves event order across subscribers", () => {
    const order: string[] = [];
    bus.subscribe(() => order.push("first"));
    bus.subscribe(() => order.push("second"));
    bus.subscribe(() => order.push("third"));
    bus.emit({ type: "error", message: "ord", ts: 1 } as const);
    expect(order).toEqual(["first", "second", "third"]);
  });
});
