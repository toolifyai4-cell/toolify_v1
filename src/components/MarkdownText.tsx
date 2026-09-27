import React from "react";
import { Text } from "ink";

export interface MarkdownTextProps {
  /** Raw markdown string from the agent or user. */
  content: string;
}

/** Block-level token returned by `parseBlock`. */
interface BlockToken {
  type: "header" | "list" | "table" | "text";
  level?: number; // header level 1-6
  bullet?: string; // list bullet prefix
  text: string;
  table?: { headers: string[]; rows: string[][] };
}

/**
 * Lightweight inline Markdown renderer for terminal output.
 * No external dependencies — pure TypeScript.
 *
 * Supports:
 *   Inline: **bold**, *italic*, _italic_, `code`
 *   Block:  # / ## / ### headers (1-6 levels), - / * bullets, 1. numbered
 *
 * Parsing strategy (priority order avoids ambiguity):
 *   1. Code spans (`...`) — extracted first so markdown isn't parsed inside.
 *   2. Bold (**...**) — greedy span.
 *   3. Italic (*...* / _..._) — remaining emphasis.
 */

/** Split one line into a block-level token. */
export function parseBlock(line: string): BlockToken {
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    return { type: "header", level: h[1]!.length, text: h[2]! };
  }
  const ul = line.match(/^[-*]\s+(.*)$/);
  if (ul) {
    return { type: "list", bullet: "•", text: ul[1]! };
  }
  const ol = line.match(/^(\d+)\.\s+(.*)$/);
  if (ol) {
    return { type: "list", bullet: `${ol[1]}.`, text: ol[2]! };
  }
  return { type: "text", text: line };
}

/** Parse a markdown table row into cell strings. */
function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

/** Render a markdown table as an ANSI-borded grid. */
function renderTable(table: { headers: string[]; rows: string[][] }): React.ReactElement {
  const allRows = [table.headers, ...table.rows];
  const colWidths = table.headers.map((_, colIdx) =>
    Math.max(...allRows.map((row) => (row[colIdx] ?? "").length), table.headers[colIdx]!.length),
  );

  const topBorder = `┌${colWidths.map((w) => "─".repeat(w + 2)).join("┬")}┐`;
  const midBorder = `├${colWidths.map((w) => "─".repeat(w + 2)).join("┼")}┤`;
  const botBorder = `└${colWidths.map((w) => "─".repeat(w + 2)).join("┴")}┘`;

  const renderRow = (row: string[], isHeader: boolean = false) => {
    const cells = row
      .map((cell, i) => {
        const content = cell ?? "";
        const padding = " ".repeat((colWidths[i] ?? 0) - content.length);
        return ` ${content}${padding} `;
      })
      .join("│");
    return isHeader ? (
      <Text key={`hdr-${Math.random()}`} bold>
        {"│"}{cells}{"│"}
      </Text>
    ) : (
      <Text key={`row-${Math.random()}`}>
        {"│"}{cells}{"│"}
      </Text>
    );
  };

  const lines: React.ReactNode[] = [];
  lines.push(<Text key="top">{topBorder}</Text>);
  lines.push(renderRow(table.headers, true));
  lines.push(<Text key="mid">{midBorder}</Text>);
  table.rows.forEach((row, idx) => {
    lines.push(renderRow(row, false));
  });
  lines.push(<Text key="bot">{botBorder}</Text>);

  return <>{lines}</>;
}

/** Parse inline markdown and return an array of styled React nodes. */
export function renderInline(text: string): React.ReactNode[] {
  if (!text) return [];

  const nodes: React.ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < text.length) {
    // `code` span — highest priority
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        nodes.push(
          <Text key={`code-${key++}`} color="cyan">
            {text.slice(i + 1, end)}
          </Text>,
        );
        i = end + 1;
        continue;
      }
    }

    // **bold** — greedy
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        const inner = text.slice(i + 2, end);
                nodes.push(
          <Text key={`bold-${key++}`} bold color="green">
            {renderInline(inner)}
          </Text>,
        );
        i = end + 2;
        continue;
      }
    }

    // *italic* (single asterisk, not part of **)
    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        const inner = text.slice(i + 1, end);
        nodes.push(
          <Text key={`italic-${key++}`} dimColor>
            {renderInline(inner)}
          </Text>,
        );
        i = end + 1;
        continue;
      }
    }

    // _italic_ (underscore variant)
    if (text[i] === "_") {
      const end = text.indexOf("_", i + 1);
      if (end > i + 1) {
        const inner = text.slice(i + 1, end);
        nodes.push(
          <Text key={`underscore-${key++}`} dimColor>
            {renderInline(inner)}
          </Text>,
        );
        i = end + 1;
        continue;
      }
    }

    // Regular character — consume until we hit a special character
    const nextSpecial = Math.min(
      ...["`", "**", "*", "_"]
        .map((m) => {
          const idx = text.indexOf(m, i);
          return idx === -1 ? Infinity : idx;
        })
        .filter((n) => n > i),
    );
    const end = nextSpecial === Infinity ? text.length : nextSpecial;
    if (end === i) {
      nodes.push(<Text key={`char-${key++}`}>{text[i] || ""}</Text>);
      i += 1;
    } else {
      nodes.push(<Text key={`text-${key++}`}>{text.slice(i, end)}</Text>);
      i = end;
    }
  }

  return nodes;
}

/** Pre-scan lines for markdown tables. Returns blocks with table parsed. */
function groupLines(lines: string[]): BlockToken[] {
  const blocks: BlockToken[] = [];
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      const headers = parseTableRow(tableBuffer[0]!);
      const rows = tableBuffer.slice(1).filter((l) => !l.includes("---")).map(parseTableRow);
      if (headers.length > 0) {
        blocks.push({
          type: "table",
          text: "",
          table: { headers, rows },
        });
      }
    }
    tableBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes("|") && (trimmed.startsWith("|") || trimmed.endsWith("|"))) {
      tableBuffer.push(trimmed);
    } else {
      flushTable();
      const block = parseBlock(line);
      blocks.push(block);
    }
  }
  flushTable();

  return blocks;
}

/**
 * Render a markdown `content` string as a series of styled Ink `<Box>` elements.
 *
 * Each block becomes its own `<Box paddingBottom={1}>`:
 *   - Headers are bold yellow
 *   - Bold (**text**) is bold green
 *   - Lists get paddingLeft={2}
 *   - Tables are rendered as ANSI-borded grids
 */
export function MarkdownText({ content }: MarkdownTextProps): React.ReactElement {
  if (!content) return <></>;

  const lines = content.split("\n");
  const blocks = groupLines(lines);

  return (
    <>{blocks.map((block, idx) => (
      <Text key={idx} dimColor={block.type === "list"}>
        {block.type === "header" ? (
          <Text bold color="yellow">
            {renderInline(block.text)}
          </Text>
        ) : block.type === "list" ? (
          renderInline(`${block.bullet} ${block.text}`)
        ) : block.type === "table" ? (
          block.table ? renderTable(block.table) : null
        ) : (
          renderInline(block.text)
        )}
      </Text>
    ))}</>
  );
}
