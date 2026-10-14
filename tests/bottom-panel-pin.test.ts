import { describe, it, expect } from "vitest";
import React from "react";
import { Readable, Writable } from "node:stream";
import { render } from "ink";
import {
  ChatUI,
  BOTTOM_PANEL_HEIGHT,
  type ChatUIProps,
} from "../src/components/ChatUI.js";
import { draftFromParts } from "../src/components/settings.js";
import type { ModelDescriptor } from "../src/models/model-registry.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeStdout(rows = 24, columns = 80) {
  const writes: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      writes.push(chunk.toString());
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stream, { isTTY: true, columns, rows });
  return { stream, writes };
}

function makeStdin() {
  const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  return stdin;
}

function baseProps(overrides: Partial<ChatUIProps> = {}): ChatUIProps {
  return {
    messages: [],
    status: { model: "gpt-4o", inputTokens: 0, outputTokens: 0, turnCount: 0 },
    mode: "act",
    autoApprove: "off",
    workspace: "C:\\TOOLIFY_V1",
    isRunning: false,
    onSubmit: () => {},
    onModeToggle: () => {},
    onAutoApproveToggle: () => {},
    onClear: () => {},
    onExit: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

const stripAnsi = (s: string): string => s.replace(/\x1b[[0-9;?]*[A-Za-z]/g, "");

/** Latest complete frame (win32 wraps every frame in BSU/ESU markers). */
function latestFrame(writes: string[]): string {
  const raw = writes.join("");
  const segments = raw.split("\x1b[?2026h");
  return stripAnsi(segments[segments.length - 1] ?? "");
}

/** Row of the input box (contains the "You" badge). */
function inputRow(lines: string[]): number {
  return lines.findIndex((l) => l.includes("You"));
}

const MODELS: readonly ModelDescriptor[] = [
  { id: "alpha", displayName: "Alpha", providerId: "test", providerName: "Test Provider", contextLimit: "128K", isFree: false },
  { id: "beta", displayName: "Beta", providerId: "test", providerName: "Test Provider", contextLimit: "256K", isFree: false },
];

/**
 * Regression tests: the input box + status bar must stay pinned to the
 * bottom row of the terminal no matter what renders above them. The modal
 * branches used to render at their natural height, so with a modal open the
 * bottom panel stacked right under it and floated above the terminal edge.
 * The message area now always fills rows - BOTTOM_PANEL_HEIGHT.
 */
describe("bottom panel stays pinned with modals open", () => {
  it("pins input + status at the bottom when the Settings modal is open", async () => {
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(
      React.createElement(
        ChatUI,
        baseProps({
          settingsOpen: true,
          settingsInitial: draftFromParts({
            provider: "openai",
            model: "gpt-4o",
            mode: "act",
            autoApprove: "off",
          }),
          onSettingsSave: () => {},
        }),
      ),
      { stdout: stream, stdin, exitOnCtrlC: false, interactive: true },
    );
    try {
      await sleep(400);
      const frame = latestFrame(writes);
      const lines = frame.split("\n");

      expect(frame).toContain("Settings"); // modal rendered
      // Same pinned position as the normal chat view: rows - 7 + 2.
      expect(inputRow(lines)).toBe(24 - BOTTOM_PANEL_HEIGHT + 2);
      const statusIndex = lines.findIndex((l) => l.includes("Auto-approve off"));
      expect(statusIndex).toBeGreaterThan(inputRow(lines));
      expect(lines.length).toBeGreaterThanOrEqual(23);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });

  it("pins input + status at the bottom when the Models tab is open", async () => {
    const { stream, writes } = makeStdout(24, 80);
    const stdin = makeStdin();
    const instance = render(
      React.createElement(
        ChatUI,
        baseProps({
          modelsOpen: true,
          models: MODELS,
          activeModel: "alpha",
          activeProviderId: "test",
          onModelsCommit: () => {},
          onModelsClose: () => {},
        }),
      ),
      { stdout: stream, stdin, exitOnCtrlC: false, interactive: true },
    );
    try {
      await sleep(400);
      const frame = latestFrame(writes);
      const lines = frame.split("\n");

      expect(frame).toContain("Alpha"); // models list rendered
      expect(inputRow(lines)).toBe(24 - BOTTOM_PANEL_HEIGHT + 2);
      const statusIndex = lines.findIndex((l) => l.includes("Auto-approve off"));
      expect(statusIndex).toBeGreaterThan(inputRow(lines));
      expect(lines.length).toBeGreaterThanOrEqual(23);
    } finally {
      instance.unmount();
      await sleep(50);
    }
  });
});
