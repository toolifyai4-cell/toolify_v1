/**
 * Auth types for TOOLIFY — shared shapes for login sessions and OAuth providers.
 */

/** OAuth provider identifiers that the onboarding wizard exposes. */
export type AuthProviderId = "google" | "github";

/** Minimal user profile we store after a successful login. */
export interface AuthUser {
  readonly provider: AuthProviderId;
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
  readonly accountName?: string;
}

/** One refreshable OAuth session, persisted to .toolify/auth.json. */
export interface AuthSession {
  readonly provider: AuthProviderId;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly user: AuthUser;
}

/** A provider that knows how to build its authorize URL, exchange a code for tokens, and fetch the user profile. */
export interface OAuthProvider {
  readonly id: AuthProviderId;
  readonly name: string;
  readonly authorizeUrl: (redirectUri: URL) => URL;
  /** Exchange an authorization `code` for tokens + profile. Throws on failure. */
  exchange(code: string, redirectUri: URL): Promise<AuthSession>;
}
