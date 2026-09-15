/**
 * Auth session persistence — global identity store at ~/.toolify/auth.json
 * (Option A: login once, works in every project; model config stays per-project).
 *
 * Legacy per-workspace sessions (<workspace>/.toolify/auth.json) are migrated
 * forward automatically on first load.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AuthSession } from "./types.js";

const AUTH_FILENAME = "auth.json";

/** Global TOOLIFY home dir (~/.toolify). */
export function globalDir(): string {
  return join(homedir(), ".toolify");
}

/** Global session path (~/.toolify/auth.json). */
export function authPath(_workspace?: string): string {
  return join(globalDir(), AUTH_FILENAME);
}

/** Legacy per-workspace path, checked once for migration. */
function legacyPath(workspace: string): string {
  return resolve(workspace, ".toolify", AUTH_FILENAME);
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
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, AUTH_FILENAME), JSON.stringify(session, null, 2) + "\n", "utf8");
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
