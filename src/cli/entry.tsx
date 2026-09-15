import React from "react";
import { render, Box, Text, useInput } from "ink";
import type { ToolifyConfig } from "./run.js";
import { OnboardingWizard, type WizardResult } from "../components/OnboardingWizard.js";
import { Splash } from "../components/Splash.js";
import { runAuthFlow, loadAuthSession, isAuthSessionValid } from "../auth/index.js";
import type { AuthProviderId } from "../auth/types.js";
import { BrandHeader } from "../components/Brand.js";
import { DIM, GREEN, RESET } from "../components/ChatUI.js";

function patchTtyForFullScreen(): void {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
}

function takeOverScreen(): void {
  process.stdout.write("[?25l");
  process.stdout.write("[2J");
  process.stdout.write("[3J");
  process.stdout.write("[H");
  process.stdout.write("[?25h");
}

function WelcomeScreen({ onBegin }: { onBegin: () => void }): React.ReactElement {
  useInput((_ch: string, key: { return: boolean; escape: boolean }) => {
    if (key.return || key.escape) onBegin();
  });
  return (
    <Box flexDirection="column" alignItems="center" height="100%" paddingX={2}>
      <BrandHeader />
      <Box marginTop={2} flexDirection="column" alignItems="center">
        <Text>{`${DIM}Plan vs Act modes - verification gate - checkpoints - your models, your keys${RESET}`}</Text>
        <Box marginTop={1}>
          <Text>{`${GREEN}Press Enter to begin${RESET} ${DIM}(Esc quits)${RESET}`}</Text>
        </Box>
      </Box>
    </Box>
  );
}

export async function startEntryFlow(workspace: string, existing: ToolifyConfig | null): Promise<{ config: ToolifyConfig; userName: string } | null> {
  const session = loadAuthSession(workspace);
  const authed = isAuthSessionValid(session);
  const cfgOk = existing !== null;

  takeOverScreen();
  patchTtyForFullScreen();

  if (authed && cfgOk) {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        <Splash userName={session.user.name} onDone={() => { unmount(); resolve(); }} />,
        { exitOnCtrlC: false },
      );
    });
    return { config: existing, userName: session.user.name };
  }

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      <WelcomeScreen onBegin={() => { unmount(); resolve(); }} />,
      { exitOnCtrlC: false },
    );
  });

  const result = await new Promise<WizardResult>((resolve) => {
    const { unmount } = render(
      <OnboardingWizard
        needsAuth={!authed}
        existingConfig={cfgOk ? existing : null}
        callbacks={{
          runLogin: async (provider: AuthProviderId, opts?: { callbacks?: { onUrl?: (url: string) => void; onStatus?: (msg: string) => void } }) => {
            const s = await runAuthFlow(provider, workspace, { callbacks: opts?.callbacks });
            return { name: s.user.name, id: s.user.id };
          },
          saveConfig: async (cfg: ToolifyConfig) => {
            const { saveConfig } = await import("./run.js");
            await saveConfig(workspace, cfg);
          },
        }}
        onFinish={(r) => { unmount(); resolve(r); }}
      />,
      { exitOnCtrlC: false },
    );
  });

  if (result.kind === "cancelled") return null;
  const fresh = loadAuthSession(workspace);
  return {
    config: result.config,
    userName: fresh?.user.name ?? result.session.name,
  };
}
