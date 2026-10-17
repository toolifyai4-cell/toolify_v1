import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { NEXIPI_IDLE, type NexipiStage, nexipiLabel } from "../agent/nexipi-stages.js";

/** Quadrant glyph rotation sequence (U+25D0–U+25D3). */
export const NEXIPI_GLYPHS = ["◐", "◓", "◑", "◒"] as const;
/** Milliseconds per glyph frame — a fast, smooth ~8fps spin. */
export const NEXIPI_GLYPH_INTERVAL_MS = 120;

/** Returns the glyph for the given animation frame, cycling every 4 ticks. */
export function nexipiGlyph(frame: number): string {
  return NEXIPI_GLYPHS[frame % NEXIPI_GLYPHS.length];
}
export const NEXIPI_CORE_TAG = "[NEXIPI-CORE]";

export interface NexipiQuadrantPulseProps {
  /** Master switch. The indicator is hidden entirely when false. */
  readonly isThinking: boolean;
  /** Active stage 1..7; 0/undefined falls back to 2 (Deconstructing) while thinking. */
  readonly activeStage?: NexipiStage;
  /** Runtime-derived per-action detail ("Writing src/…"). Props-driven. */
  readonly currentDetailMessage?: string;
}

/**
 * Dynamic quadrant thinking indicator.
 *
 *   ◐ [NEXIPI-CORE] Fluxing action... Writing src/components/Header.tsx
 *
 * - The glyph rotates continuously at ~120ms while `isThinking` is true.
  * - The text line (stage + label + detail) reflects ONLY the
 *   active stage passed in from the agent runtime — this component holds
 *   no stage state of its own.
 */
export function NexipiQuadrantPulse({
  isThinking,
  activeStage,
  currentDetailMessage,
}: NexipiQuadrantPulseProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
        if (!isThinking) return;
    setFrame(0);
    const id = setInterval(
      () => setFrame((f) => (f + 1) % NEXIPI_GLYPHS.length),
      NEXIPI_GLYPH_INTERVAL_MS,
    );
    return () => {
      clearInterval(id);
      setFrame(0);
    };
  }, [isThinking]);

  if (!isThinking) return <Box />;

  const stage: NexipiStage = activeStage && activeStage >= 1 ? activeStage : 2;
  const label = nexipiLabel(stage) ?? "Thinking...";
  const detail = currentDetailMessage || "";
  const line = detail
    ? `${nexipiGlyph(frame)} ${NEXIPI_CORE_TAG} ${label} ${detail}`
    : `${nexipiGlyph(frame)} ${NEXIPI_CORE_TAG} ${label}`;

  return (
    <Box width="100%" flexShrink={0}>
      <Text color="white" wrap="truncate">
        {line}
      </Text>
    </Box>
  );
}
