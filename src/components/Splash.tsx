import React from "react";
import { Box, Text, useInput } from "ink";
import { BrandHeader } from "./Brand.js";
import { GREEN, RESET } from "./ChatUI.js";

export function Splash({
  userName,
  onDone,
}: {
  readonly userName: string;
  readonly onDone: () => void;
}): React.ReactElement {
  useInput((_ch, key) => {
    if (key.return || key.escape || (typeof _ch === "string" && _ch.length > 0)) {
      onDone();
    }
  });
  React.useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      <BrandHeader />
      <Box marginTop={1}>
        <Text>{`${GREEN}Signed in as ${userName}${RESET}`}</Text>
      </Box>
    </Box>
  );
}
