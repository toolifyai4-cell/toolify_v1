import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "ink";
import {
  NexipiQuadrantPulse,
  NEXIPI_GLYPHS,
  NEXIPI_GLYPH_INTERVAL_MS,
  nexipiGlyph,
} from "../src/components/NexipiQuadrantPulse.js";
import { NEXIPI_STAGES } from "../src/agent/nexipi-stages.js";

describe("NexipiQuadrantPulse", () => {
    it("renders the spec line: ⠋   [NEXIPI-CORE] <label> <detail>", () => {
    const out = renderToString(
      React.createElement(NexipiQuadrantPulse, {
        isThinking: true,
        activeStage: 6,
        currentDetailMessage: "Writing src/components/Header.tsx",
      }),
      { columns: 80 },
    );
    expect(out).toContain("⠋"); // glyph starts on frame 0
    expect(out).toContain("[NEXIPI-CORE]");
    expect(out).toContain("Fluxing action...");
    expect(out).toContain("Writing src/components/Header.tsx");
        expect(out).toContain("⠋   [NEXIPI-CORE] Fluxing action... Writing src/components/Header.tsx");
  });

    it("renders every stage label with the spec line", () => {
    for (const { n, label } of NEXIPI_STAGES) {
      const out = renderToString(
        React.createElement(NexipiQuadrantPulse, { isThinking: true, activeStage: n }),
        { columns: 80 },
      );
            expect(out).toContain(`⠋   [NEXIPI-CORE] ${label}`);
      expect(out).toContain(label);
      expect(out).toContain("[NEXIPI-CORE]");
    }
  });

  it("omits the detail field when none is provided", () => {
    const out = renderToString(
      React.createElement(NexipiQuadrantPulse, { isThinking: true, activeStage: 2 }),
      { columns: 80 },
    );
        expect(out).toContain("[NEXIPI-CORE] Deconstructing prompt...");
  });

  it("renders nothing when not thinking (idle)", () => {
    const out = renderToString(
      React.createElement(NexipiQuadrantPulse, { isThinking: false, activeStage: 0 }),
      { columns: 80 },
    );
    expect(out).not.toContain("[NEXIPI-CORE]");
  });

  it("defaults an unspecified activeStage to 2 (Deconstructing) while thinking", () => {
    const out = renderToString(
      React.createElement(NexipiQuadrantPulse, { isThinking: true }),
      { columns: 80 },
    );
        expect(out).toContain("Deconstructing prompt...");
  });

    it("cycles the Braille glyph every 10 frames at a 120ms cadence (fake timers)", () => {
    expect(NEXIPI_GLYPHS).toEqual(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
    expect(NEXIPI_GLYPH_INTERVAL_MS).toBe(120);

    // Mirrors the component's setInterval-driven setFrame reducer so the
    // rotation cadence is validated deterministically without depending on
    // ink's interactive render (which patches console in some worker envs).
    let frame = 0;
    vi.useFakeTimers();
    const id = setInterval(
      () => {
        frame = (frame + 1) % NEXIPI_GLYPHS.length;
      },
      NEXIPI_GLYPH_INTERVAL_MS,
    );
    expect(nexipiGlyph(frame)).toBe("⠋"); // initial
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠙");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠹");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠸");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠼");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠴");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠦");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠧");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠇");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠏");
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠋"); // wraps back to frame 0
    vi.advanceTimersByTime(120);
    expect(nexipiGlyph(frame)).toBe("⠙");
    clearInterval(id);
    vi.useRealTimers();
  });
});
