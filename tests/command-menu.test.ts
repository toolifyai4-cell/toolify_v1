import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "ink";
import {
  CommandMenu,
  SLASH_COMMANDS,
  filterSlashCommands,
  COMMAND_MENU_PAGE_SIZE,
} from "../src/components/CommandMenu.js";

describe("filterSlashCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });
  it("filters by prefix after the slash", () => {
    expect(filterSlashCommands("set").map((c) => c.name)).toEqual(["/settings"]);
    expect(filterSlashCommands("SET").map((c) => c.name)).toEqual(["/settings"]);
    expect(filterSlashCommands("h").map((c) => c.name).sort()).toEqual(["/help", "/history"]);
  });
  it("returns an empty list when nothing matches", () => {
    expect(filterSlashCommands("zzz")).toEqual([]);
  });
});

describe("CommandMenu layout", () => {
  function shot(names: string[], selectedIndex: number, columns = 100): string {
    const cmds = names.map((name) => ({ name, description: `desc-${name}` }));
    return renderToString(
      React.createElement(CommandMenu, { commands: cmds, selectedIndex }),
      { columns },
    );
  }
  it("shows the first 6 commands with name left / description right", () => {
    const out = renderToString(
      React.createElement(CommandMenu, { commands: SLASH_COMMANDS, selectedIndex: 0 }),
      { columns: 110 },
    );
    // First 6-row window: names + descriptions visible ...
    for (const cmd of SLASH_COMMANDS.slice(0, 6)) {
      expect(out).toContain(cmd.name);
      expect(out).toContain(cmd.description);
    }
    // ... while the last two scroll out behind the overflow indicator.
    expect(out).toContain("2 more");
    expect(out).not.toContain("/quit");
  });
  it("highlights the selected row with a '> ' prefix", () => {
    const out = shot(["/settings", "/model", "/theme"], 1);
    expect(out).toContain("> /model");
    expect(out).not.toContain("> /settings");
  });
  it("shows at most 6 rows plus a 'v X more' overflow line", () => {
    expect(COMMAND_MENU_PAGE_SIZE).toBe(6);
    const out = renderToString(
      React.createElement(CommandMenu, { commands: SLASH_COMMANDS, selectedIndex: 0 }),
      { columns: 110 },
    );
    expect(out).toContain("more");
    expect(out).toContain("2 more");
    // First window: /quit and /usage are scrolled out of view.
    expect(out).not.toContain("/quit");
  });
  it("scrolls the 6-row window so the highlight stays visible", () => {
    const out = renderToString(
      React.createElement(CommandMenu, { commands: SLASH_COMMANDS, selectedIndex: 7 }),
      { columns: 110 },
    );
    expect(out).toContain("> /quit");
    expect(out).toContain("/usage");
    expect(out).not.toContain("/settings");
  });
  it("renders nothing when the filter matches nothing", () => {
    expect(
      renderToString(
        React.createElement(CommandMenu, { commands: [], selectedIndex: 0 }),
        { columns: 80 },
      ),
    ).toBe("");
  });
});
