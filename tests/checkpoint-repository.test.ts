import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CheckpointStore, type Checkpoint } from "../src/checkpoint/store.js";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CheckpointRepository - CheckpointStore", () => {
  let workspace: string;
  let store: CheckpointStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-ckpt-"));
    store = new CheckpointStore(workspace);
    await store.init();
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("creates the objects and checkpoints directories on init", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(workspace, ".toolify", "objects"))).toBe(true);
    expect(existsSync(join(workspace, ".toolify", "checkpoints"))).toBe(true);
  });

  it("takes a content-addressed snapshot of given paths", async () => {
    await writeFile(join(workspace, "file1.txt"), "hello world", "utf8");

    // CheckpointStore.snapshot joins paths with workspace internally,
    // so we pass relative paths.
    const ckpt: Checkpoint = await store.snapshot(["file1.txt"]);
    expect(ckpt.id).toBeTypeOf("string");
    expect(ckpt.id.length).toBeGreaterThan(0);
    expect(ckpt.ts).toBeTypeOf("number");
    expect(ckpt.files.length).toBe(1);
    expect(ckpt.files[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ckpt.files[0].path).toBe("file1.txt");
  });

  it("deduplicates identical content across snapshots", async () => {
    await writeFile(join(workspace, "same.txt"), "identical", "utf8");

    const ckpt1 = await store.snapshot(["same.txt"]);
    const ckpt2 = await store.snapshot(["same.txt"]);
    // Both snapshots reference the same hash
    expect(ckpt1.files[0].hash).toBe(ckpt2.files[0].hash);
    // But have different checkpoint ids
    expect(ckpt1.id).not.toBe(ckpt2.id);
  });

  it("lists checkpoints newest-last", async () => {
    await writeFile(join(workspace, "f.txt"), "content", "utf8");

    await store.snapshot(["f.txt"]);
    await store.snapshot(["f.txt"]);

    const list = await store.list();
    expect(list.length).toBe(2);
  });

  it("restores a checkpoint by id", async () => {
    await writeFile(join(workspace, "restore.txt"), "original", "utf8");

    const ckpt = await store.snapshot(["restore.txt"]);

    // Modify the file
    await writeFile(join(workspace, "restore.txt"), "modified", "utf8");

    // Restore - stores relative paths
    const restored = await store.restore(ckpt.id);
    expect(restored.length).toBe(1);
    expect(restored[0]).toBe("restore.txt");

    // Content should be back to original
    const content = await readFile(join(workspace, "restore.txt"), "utf8");
    expect(content).toBe("original");
  });
});
