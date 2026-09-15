/**
 * Auth orchestrator — runs the full OAuth login flow for a given provider and
 * persists the resulting session to ~/.toolify/auth.json (global identity).
 */

import { startCallbackServer, openAuthorizeUrl, type CallbackResult } from "./callback-server.js";
import { saveAuthSession, loadAuthSession, isAuthSessionValid, clearAuthSession } from "./session.js";
import { providerById } from "./providers.js";
import type { AuthProviderId, AuthSession } from "./types.js";

export { loadAuthSession, isAuthSessionValid, saveAuthSession, clearAuthSession };
export type { AuthSession, AuthUser, OAuthProvider } from "./types.js";

export interface AuthFlowCallbacks {
  onUrl?: (url: string) => void;
  onStatus?: (msg: string) => void;
}

/**
 * Run the OAuth login flow for `providerId`. The session is stored globally
 * (~/.toolify/auth.json) so it works in every project. `workspace` is only
 * used to pick up a legacy per-workspace session for one-time migration.
 */
export async function runAuthFlow(
  providerId: AuthProviderId,
  workspace?: string,
  options: { timeoutMs?: number; callbacks?: AuthFlowCallbacks } = {},
): Promise<AuthSession> {
  const provider = providerById(providerId);
  const timeout = options.timeoutMs ?? 5 * 60 * 1000;
  const cb = options.callbacks ?? {};

  let settleResult: ((result: CallbackResult) => void) | null = null;
  const resultPromise = new Promise<CallbackResult>((resolve, reject) => {
    settleResult = resolve;
    setTimeout(() => {
      if (settleResult !== null) {
        reject(new Error(`Timed out waiting for the ${provider.name} callback.`));
      }
    }, timeout);
  });

  const { server, port } = await startCallbackServer(
    provider,
    (result) => {
      if (settleResult !== null) {
        const r = settleResult;
        settleResult = null;
        r(result);
      }
    },
    timeout,
  );

  const redirectUri = new URL(`http://127.0.0.1:${port}/callback`);
  const authorizeUrl = provider.authorizeUrl(redirectUri);

  cb.onUrl?.(authorizeUrl.toString());
  cb.onStatus?.(`Opening browser for ${provider.name} sign-in...`);
  openAuthorizeUrl(authorizeUrl);

  let result: CallbackResult;
  try {
    result = await resultPromise;
  } catch (err) {
    server.close();
    throw err;
  }
  if (result.error !== undefined || result.code === undefined) {
    server.close();
    throw new Error(
      `${provider.name} sign-in failed: ${result.error ?? "unknown_error"}` +
      (result.errorDescription ? ` - ${result.errorDescription}` : ""),
    );
  }

  cb.onStatus?.(`Exchanging authorization code for tokens...`);
  let session: AuthSession;
  try {
    session = await provider.exchange(result.code, redirectUri);
  } catch (err) {
    server.close();
    throw err;
  }

  saveAuthSession(session, workspace);
  server.close();
  return session;
}

/** Log out: remove the global auth session (~/.toolify/auth.json). */
export function logout(_workspace?: string): boolean {
  return clearAuthSession();
}
