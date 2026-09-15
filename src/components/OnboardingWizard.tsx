import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { DIM, GREEN, RED, RESET, YELLOW, CYAN, BLUE_BRIGHT } from "./ChatUI.js";
import type { AuthProviderId } from "../auth/types.js";
import type { ToolifyConfig } from "../cli/run.js";
import { fetchModels } from "../models/fetch-models.js";

export type WizardResult =
  | { readonly kind: "complete"; readonly session: { name: string; id: string }; readonly config: ToolifyConfig }
  | { readonly kind: "cancelled" };

type Step =
  | { readonly name: "welcome" }
  | { readonly name: "auth" }
  | { readonly name: "auth-wait"; readonly provider: AuthProviderId }
  | { readonly name: "apikey"; readonly provider: ToolifyConfig["provider"] }
  | { readonly name: "fetching"; readonly provider: ToolifyConfig["provider"] }
  | { readonly name: "model"; readonly provider: ToolifyConfig["provider"] }
  | { readonly name: "summary" };

export interface WizardCallbacks {
  readonly runLogin: (provider: AuthProviderId, opts?: { callbacks?: { onUrl?: (url: string) => void; onStatus?: (msg: string) => void } }) => Promise<{ name: string; id: string }>;
  readonly saveConfig: (cfg: ToolifyConfig) => Promise<void>;
}

interface ProviderInfo {
  readonly label: string;
  readonly description: string;
  readonly defaultBaseUrl: string;
  readonly models: string[];
  readonly needsApiKey: boolean;
}

const PROVIDERS: Record<ToolifyConfig["provider"], ProviderInfo> = {
  openai: {
    label: "OpenAI",
    description: "GPT-4o, GPT-4, GPT-3.5 Turbo",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    needsApiKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    description: "DeepSeek V3, DeepSeek R1",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsApiKey: true,
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude 3.5 Sonnet, Claude 3 Opus, Claude 4 Sonnet",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-sonnet-4-20250514"],
    needsApiKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    description: "Access 100+ models via one API",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: ["auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4o", "deepseek/deepseek-chat", "google/gemini-pro"],
    needsApiKey: true,
  },
  omniroute: {
    label: "OmniRoute",
    description: "Multi-provider routing with fallbacks",
    defaultBaseUrl: "https://api.omniroute.ai/v1",
    models: ["auto", "gpt-4o", "claude-3-5-sonnet", "deepseek-chat"],
    needsApiKey: true,
  },
  unoroute: {
    label: "UnoRoute",
    description: "Single endpoint, multiple backends",
    defaultBaseUrl: "https://api.unoroute.dev/v1",
    models: ["auto", "gpt-4o-mini", "claude-3-5-sonnet"],
    needsApiKey: true,
  },
  ollama: {
    label: "Ollama",
    description: "Run models locally on your machine",
    defaultBaseUrl: "http://localhost:11434/v1",
    models: ["llama3.1", "llama3.2", "codellama", "mistral", "qwen2.5-coder", "deepseek-coder-v2"],
    needsApiKey: false,
  },
  litellm: {
    label: "LiteLLM",
    description: "Open-source LLM proxy / gateway",
    defaultBaseUrl: "http://localhost:4000/v1",
    models: ["gpt-4o", "claude-3-5-sonnet", "gemini-pro", "llama3.1"],
    needsApiKey: false,
  },
  gemini: {
    label: "Google Gemini",
    description: "Gemini Pro, Gemini Flash, Gemini 2.0",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
    needsApiKey: true,
  },
  mock: {
    label: "Mock (offline)",
    description: "Scripted responses, no API key needed",
    defaultBaseUrl: "",
    models: ["mock-scripted"],
    needsApiKey: false,
  },
};

const PROVIDER_ORDER: Array<ToolifyConfig["provider"]> = [
  "openai", "deepseek", "anthropic", "openrouter", "omniroute", "unoroute", "ollama", "litellm", "gemini", "mock",
];
export function OnboardingWizard({
  needsAuth,
  existingConfig,
  callbacks,
  onFinish,
}: {
  readonly needsAuth: boolean;
  readonly existingConfig: ToolifyConfig | null;
  readonly callbacks: WizardCallbacks;
  readonly onFinish: (result: WizardResult) => void;
}): React.ReactElement {
  const [step, setStep] = React.useState<Step>(
    needsAuth ? { name: "auth" } : { name: "apikey", provider: "openai" },
  );
  const [error, setError] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<{ name: string; id: string } | null>(null);
  const [provider, setProvider] = React.useState<ToolifyConfig["provider"]>(
    existingConfig?.provider ?? "openai",
  );
  const [model, setModel] = React.useState<string>(existingConfig?.model ?? "gpt-4o");
  const [baseUrl, setBaseUrl] = React.useState<string>(existingConfig?.baseUrl ?? "");
  const [apiKey, setApiKey] = React.useState<string>("");
  const [fetchedModels, setFetchedModels] = React.useState<string[] | null>(null);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<string>("");
  const [blink, setBlink] = React.useState(true);

  // Blink cursor on the apikey step
  React.useEffect(() => {
    if (step.name !== "apikey") return;
    const t = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(t);
  }, [step.name]);

  useInput((ch, key) => {
    if (key.escape) {
      onFinish({ kind: "cancelled" });
      return;
    }
    if (step.name === "welcome" && key.return) {
      setStep(needsAuth ? { name: "auth" } : { name: "apikey", provider: "openai" });
      return;
    }
    if (step.name === "summary" && key.return) {
      const cfg: ToolifyConfig = {
        provider,
        model,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      };
      void callbacks.saveConfig(cfg).then(() => {
        onFinish({
          kind: "complete",
          session: session ?? { name: "signed in", id: "" },
          config: cfg,
        });
      });
      return;
    }
    if (step.name === "apikey") {
      if (key.return) {
        const val = draft.trim();
        if (!val) {
          setFetchError("API key is required");
          return;
        }
        setApiKey(val);
        setDraft("");
        setFetchError(null);
        setFetchedModels(null);
        setStep({ name: "fetching", provider });
        return;
      }
      if (key.delete || key.backspace) {
        setDraft((d) => d.slice(0, -1));
        return;
      }
      if (typeof ch === "string" && ch.length >= 1 && !key.ctrl && !key.meta && !key.return) {
        setDraft((d) => d + ch);
      }
      return;
    }
  });

  // Fetch models when entering the "fetching" step
  React.useEffect(() => {
    if (step.name !== "fetching") return;
    let cancelled = false;
    void fetchModels(provider, baseUrl, apiKey).then(
      (models) => {
        if (!cancelled) afterFetch(models, null);
      },
      (err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          afterFetch([], msg);
        }
      },
    );
    return () => { cancelled = true; };
  }, [step.name, provider, baseUrl, apiKey]);

  const [authUrl, setAuthUrl] = React.useState<string>("");
  const [authStatus, setAuthStatus] = React.useState<string>("");

  const doLogin = (id: AuthProviderId): void => {
    setError(null);
    setAuthUrl("");
    setAuthStatus("");
    setStep({ name: "auth-wait", provider: id });
    void callbacks.runLogin(id, {
      callbacks: { onUrl: setAuthUrl, onStatus: setAuthStatus },
    }).then(
      (s) => {
        setSession(s);
        // After auth, go straight to API key for the default provider
        setProvider("openai");
        setModel("gpt-4o");
        setBaseUrl("https://api.openai.com/v1");
        setDraft("");
        setFetchError(null);
        setFetchedModels(null);
        setStep({ name: "apikey", provider: "openai" });
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStep({ name: "auth" });
      },
    );
  };

  const pickProvider = (p: ToolifyConfig["provider"]): void => {
    setProvider(p);
    setFetchedModels(null);
    setFetchError(null);
    setApiKey("");
    const info = PROVIDERS[p];
    setModel(info.models[0]);
    if (info.defaultBaseUrl) {
      setBaseUrl(info.defaultBaseUrl);
    }
    // If the provider needs an API key, ask for it first
    if (info.needsApiKey) {
      setStep({ name: "apikey", provider: p });
    } else {
      // No key needed — skip to model selection with hardcoded list
      setStep({ name: "model", provider: p });
    }
  };

  const afterFetch = (models: string[], errMsg: string | null): void => {
    setFetchedModels(models.length > 0 ? models : null);
    setFetchError(errMsg);
    if (models.length > 0) {
      setModel(models[0]);
    }
    // After fetching models, go to model selection
    setStep({ name: "model", provider });
  };

  const pickModel = (m: string, forProvider: ToolifyConfig["provider"]): void => {
    setModel(m);
    setProvider(forProvider);
    setStep({ name: "summary" });
  };
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>{`${CYAN}Settings${RESET}`}</Text>
      {error !== null && (
        <Box marginY={1}>
          <Text>{`${RED}Sign-in failed: ${error}${RESET}`}</Text>
        </Box>
      )}
      {step.name === "welcome" && (
        <Box flexDirection="column" alignItems="center">
          <Text>{`${DIM}Plan vs Build modes - verification gate - checkpoints - your models, your keys${RESET}`}</Text>
          <Box marginTop={1}>
            <Text>{`${GREEN}Press Enter to begin${RESET} ${DIM}(Esc quits)${RESET}`}</Text>
          </Box>
        </Box>
      )}
      {step.name === "auth" && (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
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
            onSelect={(item) => doLogin(item.value as AuthProviderId)}
          />
          <Box marginTop={1}>
            <Text>{`${DIM}↑↓ to navigate · Enter to select · Esc to quit${RESET}`}</Text>
          </Box>
        </Box>
      )}
      {step.name === "auth-wait" && (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
          width={60}
        >
          <Box alignItems="center">
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text>{`  ${authStatus || "Opening browser for sign-in..."}`}</Text>
          </Box>
          {authUrl && (
            <Box marginTop={1} flexDirection="column">
              <Text>{`${DIM}If the browser didn't open, copy-paste this URL:${RESET}`}</Text>
              <Text>{`${CYAN}${authUrl}${RESET}`}</Text>
              <Box marginTop={1}>
                <SelectInput
                  items={[
                    { label: "Copy URL to clipboard", value: "copy" },
                    { label: "I signed in, continue", value: "done" },
                  ]}
                  onSelect={(item) => {
                    if (item.value === "copy") {
                      try {
                        const { execSync } = require("node:child_process");
                        if (process.platform === "win32") {
                          execSync(`clip`, { input: authUrl });
                        } else if (process.platform === "darwin") {
                          execSync(`pbcopy`, { input: authUrl });
                        } else {
                          execSync(`xclip -selection clipboard`, { input: authUrl });
                        }
                        setAuthStatus("URL copied to clipboard!");
                      } catch {
                        setAuthStatus("Could not copy - please copy manually");
                      }
                    }
                  }}
                />
              </Box>
              <Text>{`${DIM}Complete the sign-in there, then return here.${RESET}`}</Text>
            </Box>
          )}
        </Box>
      )}
      {step.name === "apikey" && (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
          width={60}
        >
          <Box marginBottom={1} flexDirection="column">
            <Text bold>{`${CYAN}Settings — ${PROVIDERS[step.provider].label}${RESET}`}</Text>
            <Text>{`${DIM}Paste your API key, then press Enter${RESET}`}</Text>
          </Box>
          {fetchError && (
            <Box marginBottom={1}>
              <Text>{`${RED}⚠ ${fetchError}${RESET}`}</Text>
            </Box>
          )}
          <Box alignItems="center">
            <Text>{YELLOW}Key:{RESET} </Text>
            <Text>{draft || " "}</Text>
            <Text>{blink ? `${CYAN}█${RESET}` : " "}</Text>
          </Box>
          <Box marginTop={1}>
            <Text>{`${DIM}Enter = continue · Esc = back${RESET}`}</Text>
          </Box>
        </Box>
      )}
      {step.name === "fetching" && (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
          width={60}
        >
          <Box alignItems="center">
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text>{`  Fetching models from ${PROVIDERS[step.provider].label}...`}</Text>
          </Box>
          <Box marginTop={1}>
            <Text>{`${DIM}Validating your API key${RESET}`}</Text>
          </Box>
        </Box>
      )}
      {step.name === "model" && (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
          width={60}
        >
          <Box marginBottom={1} flexDirection="column">
            <Text bold>{`${CYAN}Settings — Choose a Model${RESET}`}</Text>
            <Text>{`${DIM}Provider: ${PROVIDERS[step.provider].label}${RESET}`}</Text>
            {fetchedModels && (
              <Text>{`${GREEN}✓ Connected — ${fetchedModels.length} models available${RESET}`}</Text>
            )}
            {fetchError && (
              <Text>{`${YELLOW}⚠ Could not fetch: ${fetchError}${RESET}`}</Text>
            )}
          </Box>
          <SelectInput
            items={(fetchedModels ?? PROVIDERS[step.provider]?.models ?? ["mock-scripted"]).map((m) => ({ label: m, value: m }))}
            onSelect={(item) => pickModel(String(item.value), step.provider)}
          />
          <Box marginTop={1}>
            <Text>{`${DIM}Enter = confirm · Esc = back${RESET}`}</Text>
          </Box>
        </Box>
      )}
      {step.name === "summary" && (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={2}
          paddingY={1}
          width={60}
        >
          <Box marginBottom={1} flexDirection="column">
            <Text bold>{`${CYAN}Ready to go${RESET}`}</Text>
            <Text>{`${DIM}Your configuration is saved${RESET}`}</Text>
          </Box>
          <Box flexDirection="column" marginY={1}>
            <Text>{`${GREEN}Provider${RESET}  ${PROVIDERS[provider].label}`}</Text>
            <Text>{`${GREEN}Model${RESET}     ${model}`}</Text>
            {baseUrl && <Text>{`${GREEN}Base URL${RESET}  ${baseUrl}`}</Text>}
            {apiKey && <Text>{`${GREEN}API Key${RESET}   ${apiKey.slice(0, 12)}…`}</Text>}
          </Box>
          <Box marginTop={1}>
            <Text>{`${GREEN}Press Enter to start chatting${RESET}`}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}