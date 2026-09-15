const fs = require("fs");
let c = fs.readFileSync("C:/TOOLIFY_V1/src/cli/chat.tsx", "utf8");

const oldBlock = `return (
    <Box flexDirection="column" height="100%">
      {showMenu && session?.user ? (
        <MenuScreen
          userName={userName}
          user={session.user}
          config={cfg}
          usage={{
            inputTokens: meterRef.current.usage.inputTokens,
            outputTokens: meterRef.current.usage.outputTokens,
            costUsd: meterRef.current.costUsd,
          }}
          history={history}
          onEnter={() => setShowMenu(false)}
          onEsc={() => setShowMenu(false)}
        />
      ) : (
        <ChatUI
          messages={messages}
          status={{
            model: cfg.model,
            inputTokens: meterRef.current.usage.inputTokens,
            outputTokens: meterRef.current.usage.outputTokens,
            costUsd: meterRef.current.costUsd,
            turnCount,
          }}
          mode={mode}
          autoApprove={autoApprove}
          workspace={workspace}
          isRunning={isRunning}
          onSubmit={onSubmit}
          onModeToggle={() => setMode((m) => (m === "plan" ? "act" : "plan"))}
          onAutoApproveToggle={() =>
            setAutoApprove((a) => AUTO_ORDER[(AUTO_ORDER.indexOf(a) + 1) % AUTO_ORDER.length])
          }
          onClear={() => setMessages([])}
          onExit={() => process.exit(0)}
          onCancel={() => process.exit(0)}
        />
      )}
    </Box>
  );
}`;

const newBlock = `return (
    <Box flexDirection="column" height="100%">
      {/* Input bar — always at top */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
      >
        <Box alignItems="center">
          <Text>{GREEN}You ⏵ {RESET}</Text>
          <Text>
            {inputValue.length > 0 ? (
              <Text>{inputValue}</Text>
            ) : (
              <Text dimColor>Type a message or / for commands...</Text>
            )}
          </Text>
          {!isRunning && <Text>{blink ? `${CYAN}█${RESET}` : " "}</Text>}
        </Box>
      </Box>

      {/* Content area — chat or menu */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {showMenu && session?.user ? (
          <MenuScreen
            userName={userName}
            user={session.user}
            config={cfg}
            usage={{
              inputTokens: meterRef.current.usage.inputTokens,
              outputTokens: meterRef.current.usage.outputTokens,
              costUsd: meterRef.current.costUsd,
            }}
            history={history}
            onEnter={() => setShowMenu(false)}
            onEsc={() => setShowMenu(false)}
          />
        ) : (
          <ChatUI
            messages={messages}
            status={{
              model: cfg.model,
              inputTokens: meterRef.current.usage.inputTokens,
              outputTokens: meterRef.current.usage.outputTokens,
              costUsd: meterRef.current.costUsd,
              turnCount,
            }}
            mode={mode}
            autoApprove={autoApprove}
            workspace={workspace}
            isRunning={isRunning}
            onSubmit={onSubmit}
            onModeToggle={() => setMode((m) => (m === "plan" ? "act" : "plan"))}
            onAutoApproveToggle={() =>
              setAutoApprove((a) => AUTO_ORDER[(AUTO_ORDER.indexOf(a) + 1) % AUTO_ORDER.length])
            }
            onClear={() => setMessages([])}
            onExit={() => process.exit(0)}
            onCancel={() => process.exit(0)}
          />
        )}
      </Box>
    </Box>
  );
}`;

c = c.replace(oldBlock, newBlock);
fs.writeFileSync("C:/TOOLIFY_V1/src/cli/chat.tsx", c);
console.log("chat.tsx rewritten");