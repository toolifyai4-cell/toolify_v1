/**
 * NEXIPI quadrant thinking indicator — single source of truth for the
 * 1→7 stage narrative shared between the agent loop and the TUI.
 *
 * The agent core (loop.ts) emits the active stage; the React/Ink pulse
 * component (NexipiQuadrantPulse.tsx) renders it. Keeping the table here
 * lets both layers stay in sync without the agent depending on React/Ink.
 */
import type { ToolCall } from "./types.js";

export const NEXIPI_STAGES = [
  { n: 1, label: "Harmonizing context..." },
  { n: 2, label: "Deconstructing prompt..." },
  { n: 3, label: "Lensing workspace..." },
  { n: 4, label: "Quantizing routes..." },
  { n: 5, label: "Blueprinting steps..." },
  { n: 6, label: "Fluxing action..." },
  { n: 7, label: "Anchoring output..." },
] as const;

/** 0 = idle (indicator hidden); 1..7 = active stage. */
export type NexipiStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const NEXIPI_IDLE: NexipiStage = 0;

/** Label for a stage, or `undefined` when idle. */
export function nexipiLabel(stage: NexipiStage): string | undefined {
  if (stage === 0) return undefined;
  return NEXIPI_STAGES[stage - 1]?.label;
}

function inputObject(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  return input as Record<string, unknown>;
}

/** Read a path-like field (path / filePath / file / target) from tool input. */
function inputPath(input: unknown): string | undefined {
  const rec = inputObject(input);
  if (!rec) return undefined;
  for (const key of ["path", "filePath", "file", "target"]) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Read a string field from tool input. */
function inputStr(input: unknown, key: string): string | undefined {
  const rec = inputObject(input);
  if (!rec) return undefined;
  const v = rec[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/**
 * Classify a tool call into the workspace stage it belongs to, with a
 * runtime-derived detail line built from the call's inputs.
 *
 *   - read/search tools  → stage 3 "Lensing workspace..."
 *   - write/terminal tools → stage 6 "Fluxing action..."
 *
 * Returns `null` for tool calls the indicator does not surface (e.g. the
 * internal `task_digest` bookkeeping call), so the caller leaves the stage
 * unchanged.
 */
export function nexipiToolStage(
  call: ToolCall,
): { stage: 3 | 6; label: string; detail: string } | null {
  const input = call.input;
  switch (call.name) {
    // ---- Fluxing action ----
    case "write_file": {
      const p = inputPath(input);
      return { stage: 6, label: "Fluxing action...", detail: p ? `Writing ${p}` : "Writing file" };
    }
    case "edit_file": {
      const p = inputPath(input);
      return { stage: 6, label: "Fluxing action...", detail: p ? `Editing ${p}` : "Editing file" };
    }
    case "terminal": {
      const c = inputStr(input, "command");
      return {
        stage: 6,
        label: "Fluxing action...",
        detail: c ? `Running ${truncate(c, 48)}` : "Running command",
      };
    }
    // ---- Lensing workspace ----
    case "read_file": {
      const p = inputPath(input);
      return { stage: 3, label: "Lensing workspace...", detail: p ? `Reading ${p}` : "Reading file" };
    }
    case "search_files": {
      const q = inputStr(input, "query");
      return { stage: 3, label: "Lensing workspace...", detail: q ? `Searching "${truncate(q, 32)}"` : "Searching workspace" };
    }
    case "grep": {
      const q = inputStr(input, "pattern");
      return { stage: 3, label: "Lensing workspace...", detail: q ? `Grepping "${truncate(q, 32)}"` : "Searching matches" };
    }
    case "glob":
    case "list_files":
      return { stage: 3, label: "Lensing workspace...", detail: `Listing ${call.name === "list_files" ? "directory" : "files"}` };
    // Internal bookkeeping call — not surfaced as a stage.
    case "task_digest":
    default:
      return null;
  }
}
