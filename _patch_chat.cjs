const fs = require("fs");
let c = fs.readFileSync("C:/TOOLIFY_V1/src/cli/chat.tsx", "utf8");

// Replace the old conditional return with a new layout: input bar at top, content below
const oldBlock =
`  if (showMenu && session?.user) {\r\n    return (\r\n      <MenuScreen\r\n        userName={userName}\r\n        user={session.user}\r\n        config={cfg}\r\n        usage={{\r\n          inputTokens: meterRef.current.usage.inputTokens,\r\n          outputTokens: meterRef.current.usage.outputTokens,\r\n          costUsd: meterRef.current.costUsd,\r\n        }}\r\n        history={history}\r\n        onEnter={() => setShowMenu(false)}\r\n        onEsc={() => setShowMenu(false)}\r\n      />\r\n    );\r\n  }\r\n\r\n  return (\r\n    <ChatUI\r\n      messages={messages}\r\n      status={{\r\n        model: cfg.model,\r\n        inputTokens: meterRef.current.usage.inputTokens,\r\n        outputTokens: meterRef.current.usage.outputTokens,\r\n        costUsd: meterRef.current.costUsd,\r\n        turnCount,\r\n      }}\r\n      mode={mode}\r\n      autoApprove={autoApprove}\r\n      workspace={workspace}\r\n      isRunning={isRunning}\r\n      onSubmit={onSubmit}\r\n      onModeToggle={() => setMode((m) => (m === "plan" ? "act" : "plan"))}\r\n      onAutoApproveToggle={() =>\r\n        setAutoApprove((a) => AUTO_ORDER[(AUTO_ORDER.indexOf(a) + 1) % AUTO_ORDER.length])\r\n      }\r\n      onClear={() => setMessages([])}\r\n      onExit={() => process.exit(0)}\r\n      onCancel={() => process.exit(0)}\r\n    />\r\n  );\r\n}`;

const newBlock =
`  return (\r\n    <Box flexDirection="column" height="100%">\r\n      {/* Input bar — always at top */}\r\n      <Box\r\n        borderStyle="round"\r\n        borderColor="cyan"\r\n        flexDirection="column"\r\n        paddingX={1}\r\n      >\r\n        <Box alignItems="center">\r\n          <Text>{GREEN}You ⏵ {RESET}</Text>\r\n          <Text>\r\n            {inputValue.length > 0 ? (\r\n              <Text>{inputValue}</Text>\r\n            ) : (\r\n              <Text dimColor>Type a message or / for commands...</Text>\r\n            )}\r\n          </Text>\r\n          {!isRunning && <Text>{blink ? \`\${CYAN}█\${RESET}\` : " "}</Text>}\r\n        </Box>\r\n      </Box>\r\n\r\n      {/* Content area — chat or menu */}\r\n      <Box flexDirection="column" flexGrow={1} overflow="hidden">\r\n        {showMenu && session?.user ? (\r\n          <MenuScreen\r\n            userName={userName}\r\n            user={session.user}\r\n            config={cfg}\r\n            usage={{\r\n              inputTokens: meterRef.current.usage.inputTokens,\r\n              outputTokens: meterRef.current.usage.outputTokens,\r\n              costUsd: meterRef.current.costUsd,\r\n            }}\r\n            history={history}\r\n            onEnter={() => setShowMenu(false)}\r\n            onEsc={() => setShowMenu(false)}\r\n          />\r\n        ) : (\r\n          <ChatUI\r\n            messages={messages}\r\n            status={{\r\n              model: cfg.model,\r\n              inputTokens: meterRef.current.usage.inputTokens,\r\n              outputTokens: meterRef.current.usage.outputTokens,\r\n              costUsd: meterRef.current.costUsd,\r\n              turnCount,\r\n            }}\r\n            mode={mode}\r\n            autoApprove={autoApprove}\r\n            workspace={workspace}\r\n            isRunning={isRunning}\r\n            onSubmit={onSubmit}\r\n            onModeToggle={() => setMode((m) => (m === "plan" ? "act" : "plan"))}\r\n            onAutoApproveToggle={() =>\r\n              setAutoApprove((a) => AUTO_ORDER[(AUTO_ORDER.indexOf(a) + 1) % AUTO_ORDER.length])\r\n            }\r\n            onClear={() => setMessages([])}\r\n            onExit={() => process.exit(0)}\r\n            onCancel={() => process.exit(0)}\r\n          />\r\n        )}\r\n      </Box>\r\n    </Box>\r\n  );\r\n}`;

if (!c.includes(oldBlock)) {
  console.error("oldBlock not found");
  process.exit(1);
}
c = c.replace(oldBlock, newBlock);

// Add missing imports: Box, CYAN, blink state
if (!c.includes('import { Box }')) {
  c = c.replace('import { render } from "ink";', 'import { render, Box } from "ink";');
}
if (!c.includes('import { CYAN }')) {
  c = c.replace('import { ChatUI, type ChatMessage } from "../components/ChatUI.js";',
    'import { ChatUI, type ChatMessage } from "../components/ChatUI.js";\nimport { CYAN, GREEN, RESET, DIM } from "../components/ChatUI.js";');
}

// Add blink + inputValue state to ChatHost
c = c.replace(
  'const [showMenu, setShowMenu] = React.useState(false);',
  'const [showMenu, setShowMenu] = React.useState(false);\n  const [inputValue, setInputValue] = React.useState("");\n  const [blink, setBlink] = React.useState(true);'
);

// Add blink useEffect
c = c.replace(
  'const mutateMessages = React.useCallback',
  'React.useEffect(() => {\n    const t = setInterval(() => setBlink((b) => !b), 500);\n    return () => clearInterval(t);\n  }, []);\n\n  const mutateMessages = React.useCallback'
);

fs.writeFileSync("C:/TOOLIFY_V1/src/cli/chat.tsx", c);
console.log("chat.tsx rewritten");