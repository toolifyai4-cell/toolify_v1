import React from "react";
import { render, Box, Text, useInput, type Instance } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import type { ToolifyConfig } from "./run.js";
import { Splash } from "../components/Splash.js";
import { runAuthFlow, loadAuthSession, isAuthSessionValid } from "../auth/index.js";
import type { AuthProviderId, AuthSession } from "../auth/types.js";
import { BrandHeader } from "../components/Brand.js";
import { DIM, GREEN, CYAN, YELLOW, RESET } from "../components/ChatUI.js";
import {
  clearScreen,
  patchTtyForFullScreen,
  takeOverScreen,
  FULLSCREEN_RENDER_OPTIONS,
} from "./screen.js";

/**
 * Retire a finished full-screen step.
 *
 * Ink's unmount() tears the React tree down but LEAVES the last painted frame
 * on screen, and every render() draws at the current cursor position - so
 * without an explicit clear, each step (splash, sign-in, chat) stacked on top
 * of the previous one. clearScreen() is the guarantee, because instance.clear()
 * is a silent no-op whenever Ink is not in interactive mode.
 */
function endStep(instance: Instance): void {
  instance.clear();
  instance.unmount();
  clearScreen();
}

function WelcomeScreen({ onBegin }: { onBegin: () => void }): React.ReactElement {
  useInput((_ch: string, key: { return: boolean; escape: boolean }) => {
    if (key.return || key.escape) onBegin();
  });
  return (
    <Box flexDirection="column" alignItems="center" height="100%" paddingX={2}>
      <BrandHeader />
      <Box marginTop={2} flexDirection="column" alignItems="center">
        <Text>{`${DIM}Plan vs Build modes - verification gate - checkpoints - your models, your keys${RESET}`}</Text>
        <Box marginTop={1}>
          <Text>{`${GREEN}Press Enter to begin${RESET} ${DIM}(Esc quits)${RESET}`}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function AuthChoice({
  onPick,
  onCancel,
}: {
  onPick: (provider: AuthProviderId) => void;
  onCancel: () => void;
}): React.ReactElement {
  useInput((_ch: string, key: { escape: boolean }) => {
    if (key.escape) onCancel();
  });
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      width={60}
    >
      <Box marginBottom={1} flexDirection="column">
        <Text bold>{`${CYAN}Sign in to continue${RESET}`}</Text>
        <Text>{`${DIM}Choose how you want to authenticate${RESET}`}</Text>
      </Box>
      <SelectInput
        items={[
          { label: "Sign in with Google", value: "google" },
          { label: "Sign in with GitHub", value: "github" },
        ]}
        onSelect={(item) => onPick(item.value as AuthProviderId)}
      />
      <Box marginTop={1}>
        <Text>{`${DIM}↑↓ to navigate · Enter to select · Esc to quit${RESET}`}</Text>
      </Box>
    </Box>
  );
}

function AuthWait({
  provider,
  onDone,
  onCancel,
}: {
  provider: AuthProviderId;
  onDone: (session: AuthSession) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [status, setStatus] = React.useState<string>("Opening browser for sign-in...");
  const [authUrl, setAuthUrl] = React.useState<string>("");
  const [signedIn, setSignedIn] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void runAuthFlow(provider, "toolify", {
      callbacks: {
        onUrl: (url: string) => { if (!cancelled) setAuthUrl(url); },
        onStatus: (msg: string) => { if (!cancelled) setStatus(msg); },
      },
    }).then(
      (session) => {
        if (cancelled) return;
        setSignedIn(true);
        setStatus("Signed in successfully. Starting chat...");
        setTimeout(() => { if (!cancelled) onDone(session); }, 800);
      },
      (err: unknown) => {
        if (cancelled) return;
        setStatus(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    return () => { cancelled = true; };
  }, [provider, onDone]);

  useInput((_ch: string, key: { escape: boolean }) => {
    if (key.escape && !signedIn) onCancel();
  });

  const handleCopy = (): void => {
    try {
      const { execSync } = require("node:child_process");
      if (process.platform === "win32") {
        execSync("clip", { input: authUrl });
      } else if (process.platform === "darwin") {
        execSync("pbcopy", { input: authUrl });
      } else {
        execSync("xclip -selection clipboard", { input: authUrl });
      }
      setCopied(true);
    } catch {
      // ignore
    }
  };

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      width={60}
    >
      <Box alignItems="center" marginBottom={1}>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text>{`  ${status}`}</Text>
      </Box>
      {authUrl && (
        <Box marginTop={1} flexDirection="column">
          <Text>{`${DIM}If the browser didn't open, copy-paste this URL:${RESET}`}</Text>
          <Text>{`${CYAN}${authUrl}${RESET}`}</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: copied ? "URL copied to clipboard!" : "Copy URL to clipboard", value: "copy" },
                { label: "I signed in, continue", value: "done" },
              ]}
              onSelect={(item) => {
                if (item.value === "copy") {
                  handleCopy();
                } else if (item.value === "done" && signedIn) {
                  // handled by the useEffect above
                }
              }}
            />
          </Box>
          <Text>{`${DIM}Complete the sign-in there, then return here.${RESET}`}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function startEntryFlow(
  workspace: string,
  existing: ToolifyConfig | null,
): Promise<{ config: ToolifyConfig; userName: string } | null> {
  const session = loadAuthSession(workspace);
  const authed = isAuthSessionValid(session);
  const cfgOk = existing !== null;

  takeOverScreen();
  patchTtyForFullScreen();

  // Already logged in + configured → splash → chat
  if (authed && cfgOk) {
    await new Promise<void>((resolve) => {
      const instance = render(
        <Splash
          userName={session.user.name}
          onDone={() => { endStep(instance); resolve(); }}
        />,
        FULLSCREEN_RENDER_OPTIONS,
      );
    });
    return { config: existing, userName: session.user.name };
  }

  // Step 1: Welcome screen
  await new Promise<void>((resolve) => {
    const instance = render(
      <WelcomeScreen onBegin={() => { endStep(instance); resolve(); }} />,
      FULLSCREEN_RENDER_OPTIONS,
    );
  });

  // Step 2: Auth popup (Google or GitHub)
  const authResult = await new Promise<{ provider: AuthProviderId } | null>((resolve) => {
    const instance = render(
      <AuthChoice
        onPick={(provider) => { endStep(instance); resolve({ provider }); }}
        onCancel={() => { endStep(instance); resolve(null); }}
      />,
      FULLSCREEN_RENDER_OPTIONS,
    );
  });

  if (authResult === null) return null;

  // Step 3: Run auth flow (opens browser, waits for callback)
  const authedSession = await new Promise<AuthSession | null>((resolve) => {
    const instance = render(
      <AuthWait
        provider={authResult.provider}
        onDone={(s) => { endStep(instance); resolve(s); }}
        onCancel={() => { endStep(instance); resolve(null); }}
      />,
      FULLSCREEN_RENDER_OPTIONS,
    );
  });

  if (authedSession === null) return null;

  // Step 4: Directly open chat — no API key, no model selection, no summary
  const fresh = loadAuthSession(workspace);
  const cfg: ToolifyConfig = {
    provider: "openai",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
  };
  const { saveConfig } = await import("./run.js");
  await saveConfig(workspace, cfg);

  return {
    config: cfg,
    userName: fresh?.user.name ?? authedSession.user.name,
  };
}