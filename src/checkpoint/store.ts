import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Content-addressed checkpoint store (R3).
 *
 * Cline's checkpoints require a git repository and run intricate
 * stash/private-ref machinery; its own docs warn about storage and slowdown
 * on big repos. TOOLIFY instead stores each tool-touched file's content
 * under its SHA-256 hash in a local object store — O(changed files) per
 * snapshot, no git dependency, works in non-git folders.
 */

export interface FileSnapshot {
  path: string;
  hash: string;
}

export interface Checkpoint {
  id: string;
  ts: number;
  files: FileSnapshot[];
}

export class CheckpointStore {
  private readonly objectsDir: string;
  private readonly ckptDir: string;

  constructor(private readonly workspace: string) {
    this.objectsDir = join(workspace, ".toolify", "objects");
    this.ckptDir = join(workspace, ".toolify", "checkpoints");
  }

  private async hashFile(abs: string): Promise<string> {
    const buf = await readFile(abs);
    return createHash("sha256").update(buf).digest("hex");
  }

  private objectPath(hash: string): string {
    return join(this.objectsDir, hash.slice(0, 2), hash.slice(2));
  }

  async init(): Promise<void> {
    await mkdir(this.objectsDir, { recursive: true });
    await mkdir(this.ckptDir, { recursive: true });
  }

  /** Snapshot the given (tool-touched) paths; returns a checkpoint. */
  async snapshot(paths: string[]): Promise<Checkpoint> {
    await this.init();
    const id = `ckpt_${Date.now().toString(36)}_${createHash("sha1").update(paths.join("|")).digest("hex").slice(0, 6)}`;
    const files: FileSnapshot[] = [];
    for (const p of paths) {
      const abs = join(this.workspace, p);
      try {
        const st = await stat(abs);
        if (st.isDirectory()) continue;
        const hash = await this.hashFile(abs);
        const obj = this.objectPath(hash);
        try {
          await stat(obj);
        } catch {
          await mkdir(dirname(obj), { recursive: true });
          await writeFile(obj, await readFile(abs));
        }
        files.push({ path: p, hash });
      } catch {
        // file vanished since the tool touched it — skip
      }
    }
    const ckpt: Checkpoint = { id, ts: Date.now(), files };
    await writeFile(
      join(this.ckptDir, `${id}.json`),
      JSON.stringify(ckpt, null, 2),
      "utf8",
    );
    return ckpt;
  }

  /** List checkpoints, newest last. */
  async list(): Promise<Checkpoint[]> {
    let entries: string[];
    try {
      entries = await readdir(this.ckptDir);
    } catch {
      return [];
    }
    const ckpts: Checkpoint[] = [];
    for (const e of entries.filter((e) => e.endsWith(".json")).sort()) {
      try {
        ckpts.push(JSON.parse((await readFile(join(this.ckptDir, e), "utf8")).toString()));
      } catch {
        // corrupt entry — skip
      }
    }
    return ckpts;
  }

  /** Restore a checkpoint: write each file's stored content back. */
  async restore(id: string): Promise<string[]> {
    const ckpts = await this.list();
    const ckpt = ckpts.find((c) => c.id === id);
    if (!ckpt) throw new Error(`Checkpoint not found: ${id}`);
    const restored: string[] = [];
    for (const f of ckpt.files) {
      const obj = this.objectPath(f.hash);
      const content = await readFile(obj);
      const abs = join(this.workspace, f.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
      restored.push(f.path);
    }
    return restored;
  }
}
