import React from "react";
import { Box, Text } from "ink";
import { CYAN, DIM, RESET } from "./ChatUI.js";

export function BrandHeader({ subtitle }: { subtitle?: string }): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Text>{`${CYAN}  ████████╗ ██████╗  ██████╗ ██╗     ██╗███████╗██╗   ██╗${RESET}`}</Text>
      <Text>{`${CYAN}  ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██║██╔════╝╚██╗ ██╔╝${RESET}`}</Text>
      <Text>{`${CYAN}     ██║   ██║   ██║██║   ██║██║     ██║█████╗   ╚████╔╝ ${RESET}`}</Text>
      <Text>{`${CYAN}     ██║   ██║   ██║██║   ██║██║     ██║██╔══╝    ╚██╔╝  ${RESET}`}</Text>
      <Text>{`${CYAN}     ██║   ╚██████╔╝╚██████╔╝███████╗██║██║        ██║   ${RESET}`}</Text>
      <Text>{`${CYAN}     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚═╝╚═╝        ╚═╝   ${RESET}`}</Text>
      {subtitle ? (
        <Text>{DIM + "  " + subtitle + RESET}</Text>
      ) : (
        <Text>{`${DIM}  your AI coding agent in the terminal${RESET}`}</Text>
      )}
    </Box>
  );
}

export function TipLine({ index }: { index: number }): React.ReactElement {
  const tips = [
    "Tab toggles Plan / Act — explore safely, then build boldly",
    "Shift+Tab cycles auto-approve: off → writes → all",
    "Verification gate proves the work with your own tests",
    "Every step is snapshotted — checkpoints have you covered",
    "/clear wipes the thread · /cost shows spend · /exit quits",
  ];
  return (
    <Text>{`${DIM}Tip: ${tips[index % tips.length]}${RESET}`}</Text>
  );
}
