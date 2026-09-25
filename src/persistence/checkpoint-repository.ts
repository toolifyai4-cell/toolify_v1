/**
 * Checkpoint repository contract — content-addressed snapshot/restore.
 *
 * The existing `CheckpointStore` (see `src/checkpoint/store.ts`) implements
 * this interface. Its content-addressed CAS design is preserved; files
 * created *after* a checkpoint may not be fully restored (documented in
 * `docs/known-limitations.md`).
 */
import type { Checkpoint } from "../checkpoint/store.js";

// Re-export so consumers import from one place.
export type { Checkpoint } from "../checkpoint/store.js";

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/**
 * Checkpoint repository: snapshot, list, and restore workspace paths.
 *
 * Implementations should be content-addressed (deduplicating identical
 * file contents across snapshots) and must not require a Git repository.
 */
export interface CheckpointRepository {
  /** Ensure backing storage exists. */
  init(): Promise<void>;
  /** Snapshot the given (tool-touched) paths; returns a checkpoint descriptor. */
  snapshot(paths: string[]): Promise<Checkpoint>;
  /** List all checkpoints, newest last. */
  list(): Promise<Checkpoint[]>;
  /** Restore a checkpoint by id; returns the list of restored relative paths. */
  restore(id: string): Promise<string[]>;
}
