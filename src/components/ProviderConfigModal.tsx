import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { SettingsProvider } from "./settings.js";
import {
  verifyProviderKey,
  type VerifyKeyOptions,
  type VerifyKeyResult,
} from "../models/verify-key.js";

export interface ProviderConfigModalProps {
  readonly providerId: SettingsProvider;
  readonly providerName: string;
  readonly defaultModel: string;
  readonly needsBaseUrl: boolean;
  readonly guidanceText: string;
  readonly obtainUrl: string;
  readonly workspace: string;
  /** Test/render seam: open directly on a step (defaults to the guidance screen). */
  readonly initialStep?: number;
  /** Test/render seam: start with a given verification status (defaults to idle). */
  readonly initialStatus?: "idle" | "verifying" | "ok" | "error";
  /** Test seam: inject a verifier (defaults to the live `verifyProviderKey`). */
  readonly verify?: (
    providerId: SettingsProvider,
    apiKey: string,
    options?: VerifyKeyOptions,
  ) => Promise<VerifyKeyResult>;
  /**
   * Called ONLY after the key passed live verification (2xx). The host
   * persists the validated credential here; the modal stays open on its
   * success pane until the user presses Enter/Esc (which flows to onCancel).
   */
  readonly onConfirm: (providerId: SettingsProvider, apiKey: string, baseUrl: string) => void;
  readonly onCancel: () => void;
}

const STEP_LABELS = ["Link & Guidance", "Enter Key", "Verify & Save"];

export const ProviderConfigModal = (props: ProviderConfigModalProps) => {
  const [step, setStep] = React.useState(props.initialStep ?? 0);
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "verifying" | "ok" | "error">(
    props.initialStatus ?? "idle",
  );
  /** Which field owns keyboard focus on the "Enter Key" step. */
  const [focusField, setFocusField] = React.useState<"apiKey" | "baseUrl">("apiKey");
  /** Specific provider/HTTP error detail from the last failed verification. */
  const [verifyDetail, setVerifyDetail] = React.useState<string | null>(null);
  /** Invalidate stale verification results (cancel / re-run / unmount). */
  const verifyRunRef = React.useRef(0);
  const verifyAbortRef = React.useRef<AbortController | null>(null);
  /** Synchronous re-entrancy guard for rapid double-Enter keypresses. */
  const verifyInFlightRef = React.useRef(false);

  const back = React.useCallback(() => {
    if (step === 0) {
      props.onCancel();
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
    setStatus("idle");
    setFocusField("apiKey");
  }, [step, props]);

  /** Abort an in-flight verification; its result will be discarded. */
  const cancelVerification = React.useCallback(() => {
    verifyRunRef.current += 1;
    verifyInFlightRef.current = false;
    verifyAbortRef.current?.abort();
    verifyAbortRef.current = null;
  }, []);

  const runVerification = React.useCallback(() => {
    const key = apiKey.trim();
    if (!key && props.providerId !== "ollama") {
      // Ollama needs no key (its probe checks server reachability only);
      // every other provider must have one before a request is worth making.
      setStatus("error");
      return;
    }
    if (verifyInFlightRef.current) return;
    verifyInFlightRef.current = true;
    const run = ++verifyRunRef.current;
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    setVerifyDetail(null);
    setStep(2);
    setStatus("verifying");
    const verifier = props.verify ?? verifyProviderKey;
    void verifier(props.providerId, key, {
      baseUrl: baseUrl.trim() || undefined,
      signal: controller.signal,
    }).then((result) => {
      if (verifyRunRef.current !== run) return; // superseded or cancelled
      verifyInFlightRef.current = false;
      verifyAbortRef.current = null;
      if (result.ok) {
        setStatus("ok");
        // Persist ONLY the validated key; the modal remains open on the
        // success pane until Enter/Esc returns to Settings via onCancel.
        props.onConfirm(props.providerId, key, baseUrl.trim());
      } else {
        setStatus("error");
        setVerifyDetail(result.detail);
        // Return to the input with the cursor focused and the draft key
        // preserved so it can be edited or re-pasted immediately.
        setStep(1);
      }
    });
  }, [apiKey, baseUrl, props]);

  useInput((input, key) => {
    // Focused <TextInput> instances ignore arrow keys, so Up/Down are free to
    // switch between the API-key and Base-URL fields (local gateways/routers).
    if (step === 1 && props.needsBaseUrl && status !== "verifying") {
      if (key.upArrow) {
        setFocusField((f) => (f === "apiKey" ? "baseUrl" : "apiKey"));
        return;
      }
      if (key.downArrow) {
        setFocusField((f) => (f === "apiKey" ? "baseUrl" : "apiKey"));
        return;
      }
    }
    if (key.escape) {
      if (status === "verifying") {
        cancelVerification();
        back();
        return;
      }
      if (status === "ok") { props.onCancel(); return; }
      back();
      return;
    }
    if (key.return) {
      if (status === "verifying") return; // an in-flight check owns the flow
      if (status === "ok") { props.onCancel(); return; }
      if (step === 0) { setStep(1); return; }
      if (step === 1) { runVerification(); return; }
      return;
    }
    // All printable input (single keys AND multi-character terminal paste
    // buffers) is forwarded to the focused <TextInput>; nothing is consumed
    // here so the native component never misses buffered keystrokes.
  });

  return (
    <Box width="100%" height={20} justifyContent="center" alignItems="center">
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={72}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text bold color="cyan">{props.providerName} Configuration</Text>
          <Text dimColor>[Esc] Back</Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="row" paddingX={1}>
          {STEP_LABELS.map((label, i) => (
            <Text key={label} bold color={i === step ? "blue" : "gray"}>
              {i + 1}
              {". "}
              {label}
              {i < STEP_LABELS.length - 1 ? "  ·  " : ""}
            </Text>
          ))}
        </Box>
        <Box height={1} />
        <Box paddingX={1}>
          <Text dimColor>{"─".repeat(66)}</Text>
        </Box>
        <Box height={1} />

        {step === 0 && (
          <Box flexDirection="column" paddingX={1}>
            <Text>{props.guidanceText}</Text>
            <Box height={1} />
            <Text underline color="cyan">Obtain key at: {props.obtainUrl}</Text>
            <Box height={1} />
            <Text dimColor>Press Enter to continue.</Text>
          </Box>
        )}

        {step === 1 && (
          <Box flexDirection="column" paddingX={1}>
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="blue">API Key</Text>
              <Box
                borderStyle="single"
                borderColor={focusField === "apiKey" ? "cyan" : "gray"}
                paddingX={1}
                paddingY={0}
                width="100%"
              >
                <TextInput
                  focus={focusField === "apiKey"}
                  value={apiKey}
                  onChange={(v) => {
                    setApiKey(v);
                    // Editing after a failed verification clears the banner.
                    setVerifyDetail(null);
                    setStatus((s) => (s === "error" ? "idle" : s));
                  }}
                  mask="•"
                  placeholder="Paste your key here..."
                />
              </Box>
            </Box>
            {props.needsBaseUrl && (
              <Box flexDirection="column">
                <Text bold color="blue">Base URL (optional)</Text>
                <Box
                  borderStyle="single"
                  borderColor={focusField === "baseUrl" ? "cyan" : "gray"}
                  paddingX={1}
                  paddingY={0}
                  width="100%"
                >
                  <TextInput
                    focus={focusField === "baseUrl"}
                    value={baseUrl}
                    onChange={setBaseUrl}
                    placeholder="http://localhost:11434/v1"
                  />
                </Box>
              </Box>
            )}
            {verifyDetail ? (
              <Box flexDirection="column">
                <Text bold color="red">[✗] Verification Failed: Invalid API Key or Unauthorized</Text>
                <Text dimColor>{verifyDetail}</Text>
                <Text dimColor>Edit or re-paste your key, then press Enter to verify again.</Text>
              </Box>
            ) : status === "error" ? (
              <Text color="red">Please enter a valid API key before continuing.</Text>
            ) : null}
            <Box height={1} />
            <Text dimColor>Enter to continue · Esc to go back.</Text>
          </Box>
        )}

        {step === 2 && (
          <Box flexDirection="column" paddingX={1} alignItems="center">
            <Box height={2} />
            {status === "verifying" && (
              <Box alignItems="center">
                <Text color="cyan">
                  <Spinner type="dots" />
                </Text>
                <Text>  Verifying API key with provider endpoint...</Text>
              </Box>
            )}
            {status === "ok" && (
              <Box flexDirection="column" alignItems="center">
                <Text bold color="green">[✓] Configuration Verified & Successful!</Text>
                <Box height={1} />
                <Text dimColor>Key saved to ~/.toolify/config.json</Text>
                <Text dimColor>Press Enter or Esc to return to Settings.</Text>
              </Box>
            )}
            {status === "error" && (
              <Box flexDirection="column" alignItems="center">
                <Text bold color="red">[✗] Verification Failed: Invalid API Key or Unauthorized</Text>
                {verifyDetail ? <Text dimColor>{verifyDetail}</Text> : null}
                <Box height={1} />
                <Text dimColor>Press Esc to go back and try again.</Text>
              </Box>
            )}
          </Box>
        )}

        <Box height={1} />
        <Box paddingX={1}>
          <Text dimColor>{"↑/↓ switch fields · Enter submit · Esc back / cancel"}</Text>
        </Box>
      </Box>
    </Box>
  );
};