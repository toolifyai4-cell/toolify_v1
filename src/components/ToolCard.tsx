import React from "react";
import { Box, Text } from "ink";
import type { ToolCall } from "../agent/types.js";
import { useTheme } from "../theme/ThemeContext.js";
import {
  COMMAND_TOOLS,
  cardTitle,
  clipLine,
  diffLineArrays,
  highlightLine,
  splitLines,
  summarizeEdit,
  truncateArray,
  truncateLines,
} from "./ToolCards.js";

/** Output window for command/read results: head + `... N more lines` + tail. */
const OUTPUT_HEAD = 8;
const OUTPUT_TAIL = 4;
/** Diff/code window inside an editor card. */
const DIFF_HEAD = 16;
const DIFF_TAIL = 4;

export interface ToolCardResult {
  readonly content: string;
  readonly isError?: boolean;
}

export interface ToolCardProps {
  readonly call: ToolCall;
  /** Matched tool_finished result (absent while the call is still running). */
  readonly result?: ToolCardResult;
}

/**
 * Act Mode tool execution card.
 *  - command tools render `* run_commands(<command>)` + folded terminal output
 *  - editor tools render `* editor(<path>)` + `L+N lines (new)` /
 *    `L+N lines -M lines` summary + unified diff / highlighted code block
 *  - everything else renders `* <tool>(<arg>)` + folded result text
 */
export function ToolCard({ call, result }: ToolCardProps): React.ReactElement {
  const { tokens } = useTheme();
  const title = cardTitle(call);
  const input = (call.input ?? {}) as Record<string, unknown>;
  const summary = summarizeEdit(call);
  const body: React.ReactNode[] = [];

  // --- Editor card: summary header + unified diff / highlighted new-file block ---
  if (summary !== null) {
    if (summary.isNew && typeof input.content === "string") {
      body.push(<Text key="sum" color="green">{`L+${summary.added} lines (new)`}</Text>);
      const folded = truncateArray(splitLines(input.content), DIFF_HEAD, DIFF_TAIL);
      folded.head.forEach((line, i) =>
        body.push(
          <Text key={`h${i}`} color="green">{`+ ${highlightLine(clipLine(line))}`}</Text>,
        ),
      );
      if (folded.summary) body.push(<Text key="hsum" dimColor>{folded.summary}</Text>);
      folded.tail.forEach((line, i) =>
        body.push(
          <Text key={`t${i}`} color="green">{`+ ${highlightLine(clipLine(line))}`}</Text>,
        ),
      );
    } else {
      const diff = diffLineArrays(
        splitLines(typeof input.oldText === "string" ? input.oldText : ""),
        splitLines(typeof input.newText === "string" ? input.newText : ""),
      );
      body.push(
        <Text key="sum">
          <Text color="green">{`L+${summary.added} lines`}</Text>
          <Text color="red">{` -${summary.removed} lines`}</Text>
        </Text>,
      );
      const rows = [
        ...diff.removed.map((line) => ({ sign: "- ", line, add: false })),
        ...diff.added.map((line) => ({ sign: "+ ", line, add: true })),
      ];
      const folded = truncateArray(rows, DIFF_HEAD, DIFF_TAIL);
      const rowNode = (
        row: { sign: string; line: string; add: boolean },
        k: string,
      ) => (
        <Text key={k} color={row.add ? "green" : "red"}>
          {row.sign + clipLine(row.line)}
        </Text>
      );
      folded.head.forEach((row, i) => body.push(rowNode(row, `d${i}`)));
      if (folded.summary) body.push(<Text key="dsum" dimColor>{folded.summary}</Text>);
      folded.tail.forEach((row, i) => body.push(rowNode(row, `dt${i}`)));
    }
  }

  // --- Result rendering ---
  if (result) {
    if (summary !== null) {
      // Editor: status line from the tool result (success = first line, error = folded).
      if (result.isError) {
        const errFold = truncateLines(result.content, 3, 1);
        errFold.head.forEach((line, i) =>
          body.push(<Text key={`e${i}`} color="red">{clipLine(line)}</Text>),
        );
        if (errFold.summary) body.push(<Text key="esum" color="red">{errFold.summary}</Text>);
        errFold.tail.forEach((line, i) =>
          body.push(<Text key={`et${i}`} color="red">{clipLine(line)}</Text>),
        );
      } else {
        const first = splitLines(result.content)[0] ?? "";
        body.push(<Text key="status" color={tokens.success}>{clipLine(first)}</Text>);
      }
    } else {
      // Command output / read results: head + summary + tail window.
      const folded = truncateLines(result.content, OUTPUT_HEAD, OUTPUT_TAIL);
      if (result.isError) body.push(<Text key="err" color="red">[error]</Text>);
      const color = result.isError ? "red" : undefined;
      folded.head.forEach((line, i) =>
        body.push(<Text key={`o${i}`} color={color}>{line}</Text>),
      );
      if (folded.summary) body.push(<Text key="osum" dimColor>{folded.summary}</Text>);
      folded.tail.forEach((line, i) =>
        body.push(<Text key={`ot${i}`} color={color}>{line}</Text>),
      );
      if (
        !result.isError &&
        splitLines(result.content).length === 0 &&
        COMMAND_TOOLS.has(call.name)
      ) {
        body.push(<Text key="empty" dimColor>(no output)</Text>);
      }
    }
  } else {
    body.push(<Text key="pending" dimColor>…</Text>);
  }

  return (
    <Box flexDirection="column">
      <Text bold color={tokens.primary}>{title}</Text>
      {body}
    </Box>
  );
}
