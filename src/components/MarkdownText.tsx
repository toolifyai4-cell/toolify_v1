import React from "react";
import { Text } from "ink";

export interface MarkdownTextProps {
  /** Raw markdown string from the agent or user. */
  content: string;
}

/** Block-level token returned by `parseBlock`. */
interface BlockToken {
  type: "header" | "list" | "text";
  level?: number; // header level 1-6
  bullet?: string; // list bullet prefix
  text: string;
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
          <Text key={`bold-${key++}`} bold>
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

/**
 * Render a markdown `content` string as a series of styled Ink `<Text>` lines.
 *
 * Each newline becomes a new `<Text>` row; headers are bold-cyan, list items
 * get a dim bullet prefix, and inline emphasis/code are styled inline.
 */
export function MarkdownText({ content }: MarkdownTextProps): React.ReactElement {
  if (!content) return <></>;

  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, idx) => {
        if (line.trim() === "") {
          return <Text key={idx}> </Text>;
        }

        const block = parseBlock(line);

        if (block.type === "header") {
          return (
            <Text key={idx} bold color="cyan">
              {renderInline(block.text)}
            </Text>
          );
        }

        if (block.type === "list") {
          return (
            <Text key={idx} dimColor>
              {`  ${block.bullet} `}{renderInline(block.text)}
            </Text>
          );
        }

        // Plain text line — apply inline markdown
        return (
          <Text key={idx}>{renderInline(block.text)}</Text>
        );
      })}
    </>
  );
}
