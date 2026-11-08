/**
 * AuthIntegration — wraps authentication for the extension host environment.
 *
 * Provides a thin bridge between VS Code's authentication API (or the existing
 * browser-based OAuth flow in `src/auth/`) and the extension's gRPC layer.
 * The extension host can use `vscode.authentication.getSession` for native
 * VS Code sign-in, falling back to the existing session store.
 */
import * as vscode from "vscode";
import {
  loadAuthSession,
  isAuthSessionValid,
  clearAuthSession,
} from "../auth/session.js";
import type { AuthUser } from "../auth/types.js";

export interface AuthStatus {
  isAuthenticated: boolean;
  user?: AuthUser;
}

export class AuthIntegration {
  private readonly providerId: string;

  constructor(providerId: string = "toolify") {
    this.providerId = providerId;
  }

  /** Get the current auth status from the session store. */
  getStatus(): AuthStatus {
    const session = loadAuthSession();
    if (!session || !isAuthSessionValid(session)) {
      return { isAuthenticated: false };
    }
    return {
      isAuthenticated: true,
      user: session.user,
    };
  }

  /** Sign out by clearing the stored session. */
  signOut(): boolean {
    return clearAuthSession();
  }

  /**
   * Attempt native VS Code authentication (if the provider is registered in
   * package.json under `contributes.authentication`). Falls back to false
   * if no VS Code auth provider is configured.
   */
  async tryVscodeAuth(): Promise<AuthStatus | null> {
    try {
      const sessions = await vscode.authentication.getSession(this.providerId, [], {
        silent: true,
      });
      if (sessions) {
        const session = sessions;
        return {
          isAuthenticated: true,
          user: {
            name: session.account.label,
            email: session.account.id,
            provider: this.providerId,
          } as AuthUser,
        };
      }
    } catch {
      // VS Code auth not configured or not available — fall through.
    }
    return null;
  }
}

export const authIntegration = new AuthIntegration();
