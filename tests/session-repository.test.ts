import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../src/storage/session.js";
import type { AgentEvent } from "../src/agent/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SessionRepository — SessionStore", () => {
  let workspace: string;
  let store: SessionStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-session-"));
    store = new SessionStore(workspace, "test-session");
    await store.init();
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("creates the session directory on init", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(store.sessionDir)).toBe(true);
  });

  it("appends events to the JSONL log and reads them back", async () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "Hello", ts: Date.now() },
      { type: "assistant_message", content: "Hi there", ts: Date.now() + 1 },
      { type: "tool_started", call: { id: "c1", name: "read_file", input: { path: "test.txt" } }, ts: Date.now() + 2 },
    ];

    for (const e of events) {
      await store.append(e);
    }

    const read = await store.readAll();
    expect(read.length).toBe(3);
    expect(read[0].type).toBe("user_message");
    expect(read[1].type).toBe("assistant_message");
    expect(read[2].type).toBe("tool_started");
  });

  it("safely skips malformed JSONL entries", async () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "Good", ts: 1 },
      { type: "assistant_message", content: "OK", ts: 2 },
    ];
    for (const e of events) {
      await store.append(e);
    }

    // Inject a malformed line directly into the log
    const badPath = store["logPath"];
    const { appendFileSync } = await import("node:fs");
    appendFileSync(badPath, "NOT JSON\n{bad json}\n", "utf8");

    const read = await store.readAll();
    // Only the 2 valid events should be returned
    expect(read.length).toBe(2);
    expect(read.map((e) => e.type)).toEqual(["user_message", "assistant_message"]);
  });

  it("returns empty array for a fresh session", async () => {
    const read = await store.readAll();
    expect(read).toEqual([]);
  });

  it("assigns a unique session dir per instance", async () => {
    const store2 = new SessionStore(workspace, SessionStore.newId());
    expect(store.sessionDir).not.toBe(store2.sessionDir);
  });
});
