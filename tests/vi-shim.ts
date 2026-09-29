/**
 * Bun's `bun:test` runner exposes a `vi` compatibility object (imported as
 * `vitest`, matching the rest of the suite) that does NOT implement
 * `vi.stubGlobal` / `vi.unstubAllGlobals`. Several streaming / wire-format
 * tests rely on those to swap `globalThis.fetch`.
 *
 * This shim polyfills them on the shared `vi` object (it is a no-op if the
 * real implementations are already present, e.g. when running under Vitest),
 * so those tests run unchanged and their careful SSE bodies stay intact.
 */
import { vi } from "vitest";

type ViExt = typeof vi & {
  stubGlobal?: (name: string, value: unknown) => void;
  unstubAllGlobals?: () => void;
};

const v = vi as unknown as ViExt;
const originals: Record<string, unknown> = {};

if (typeof v.stubGlobal !== "function") {
  (v as Record<string, unknown>).stubGlobal = (name: string, value: unknown) => {
    if (!(name in originals)) {
      originals[name] = (globalThis as Record<string, unknown>)[name];
    }
    (globalThis as Record<string, unknown>)[name] = value;
  };
}

if (typeof v.unstubAllGlobals !== "function") {
  (v as Record<string, unknown>).unstubAllGlobals = () => {
    for (const name of Object.keys(originals)) {
      (globalThis as Record<string, unknown>)[name] = originals[name];
    }
  };
}
