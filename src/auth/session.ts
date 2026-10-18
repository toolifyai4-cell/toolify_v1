/**
 * Auth session persistence — global identity store at ~/.nexipi/auth.json
 * (Option A: login once, works in every project; model config stays per-project).
 *
 * Legacy sessions are migrated forward automatically on first load:
 *   - ~/.toolify/auth.json             →  ~/.nexipi/auth.json  (global migration)
 *   - <workspace>/.toolify/auth.json  →  ~/.nexipi/auth.json  (per-workspace migration)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AuthSession } from "./types.js";

const AUTH_FILENAME = "auth.json";
const NEXIPI_DIR = ".nexipi";
const LEGACY_DIR = ".toolify";
/** Owner read/write only — the auth file contains OAuth tokens. */
const PRIVATE_MODE = 0o600;

/** Global NEXIPI home dir (~/.nexipi). */
export function globalDir(): string {
  return join(homedir(), NEXIPI_DIR);
}

/** Global session path (~/.nexipi/auth.json). */
export function authPath(_workspace?: string): string {
  return join(globalDir(), AUTH_FILENAME);
}

/** Legacy global path (~/.toolify/auth.json) — checked once for migration. */
function legacyGlobalPath(): string {
  return join(homedir(), LEGACY_DIR, AUTH_FILENAME);
}

/** Legacy per-workspace path, checked once for migration. */
function legacyPath(workspace: string): string {
  return resolve(workspace, LEGACY_DIR, AUTH_FILENAME);
}

export function loadAuthSession(workspace?: string): AuthSession | null {
  const p = authPath(workspace);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as AuthSession;
    } catch {
      return null;
    }
  }
  // One-time migration: adopt a legacy global session (~/.toolify/auth.json).
  const lgp = legacyGlobalPath();
  if (existsSync(lgp)) {
    try {
      const session = JSON.parse(readFileSync(lgp, "utf8")) as AuthSession;
      saveAuthSession(session);
      return session;
    } catch {
      return null;
    }
  }
  // One-time migration: adopt a legacy per-workspace session if present.
  if (workspace) {
    const lp = legacyPath(workspace);
    if (existsSync(lp)) {
      try {
        const session = JSON.parse(readFileSync(lp, "utf8")) as AuthSession;
        saveAuthSession(session);
        return session;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function saveAuthSession(session: AuthSession, _workspace?: string): void {
  const dir = globalDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const p = join(dir, AUTH_FILENAME);
  writeFileSync(p, JSON.stringify(session, null, 2) + "\n", "utf8");
  // Restrict to owner-only (no-op on Windows, but secure on Unix).
  try { chmodSync(p, PRIVATE_MODE); } catch { /* ignore on FS that lacks perms */ }
}

/** Remove the global session. Returns true when a session was present. */
export function clearAuthSession(): boolean {
  const p = authPath();
  if (!existsSync(p)) return false;
  try {
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/** True when the stored session is present and not yet expired (missing expiresAt = never expires). */
export function isAuthSessionValid(session: AuthSession | null): session is AuthSession {
  if (!session) return false;
  if (!session.expiresAt) return true;
  return session.expiresAt > Date.now();
}
