import { describe, it, expect } from "vitest";
import { CheckpointStore } from "../src/checkpoint/store.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CheckpointStore (R3 — git-free CAS)", () => {
  it("snapshots and restores touched files without git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolify-ckpt-"));
    try {
      await writeFile(join(dir, "a.txt"), "version-1", "utf8");
      const store = new CheckpointStore(dir);
      await store.init();

      const ckpt = await store.snapshot(["a.txt"]);
      expect(ckpt.files).toHaveLength(1);
      expect(ckpt.files[0].path).toBe("a.txt");

      // File changes afterward…
      await writeFile(join(dir, "a.txt"), "version-2", "utf8");
      const current = (await readFile(join(dir, "a.txt"), "utf8")).toString();
      expect(current).toBe("version-2");

      // …and restore brings back the snapshotted content.
      const restored = await store.restore(ckpt.id);
      expect(restored).toEqual(["a.txt"]);
      const after = (await readFile(join(dir, "a.txt"), "utf8")).toString();
      expect(after).toBe("version-1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists checkpoints in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolify-ckpt-"));
    try {
      await writeFile(join(dir, "b.txt"), "x", "utf8");
      const store = new CheckpointStore(dir);
      await store.init();
      await store.snapshot(["b.txt"]);
      await writeFile(join(dir, "b.txt"), "y", "utf8");
      await store.snapshot(["b.txt"]);
      const list = await store.list();
      expect(list.length).toBe(2);
      expect(list[0].ts).toBeLessThanOrEqual(list[1].ts);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips missing files during snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolify-ckpt-"));
    try {
      const store = new CheckpointStore(dir);
      await store.init();
      const ckpt = await store.snapshot(["does-not-exist.txt"]);
      expect(ckpt.files).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
