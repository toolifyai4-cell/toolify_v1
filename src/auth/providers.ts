import type { OAuthProvider, AuthSession, AuthUser } from "./types.js";
import { URL, URLSearchParams } from "node:url";
import { request, get } from "node:https";

function envClientId(provider: "google" | "github"): string {
  const key =
    provider === "google" ? "TOOLIFY_GOOGLE_CLIENT_ID" : "TOOLIFY_GITHUB_CLIENT_ID";
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}. Set the matching _SECRET to enable ${provider} login.`);
  return v;
}

function envClientSecret(provider: "google" | "github"): string {
  const key =
    provider === "google" ? "TOOLIFY_GOOGLE_CLIENT_SECRET" : "TOOLIFY_GITHUB_CLIENT_SECRET";
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}. Set the matching _CLIENT_ID to enable ${provider} login.`);
  return v;
}

function postJson(url: string, body: Record<string, string>, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? request : get;
    const data = JSON.stringify(body);
    const req = mod(url, {
      method: "POST",
      timeout: timeoutMs,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`Token endpoint HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
          return;
        }
        resolve(buf);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Token request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function postForm(url: string, body: Map<string, string>, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    body.forEach((v, k) => params.append(k, v));
    const req = request(url, {
      method: "POST",
      timeout: timeoutMs,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`Token endpoint HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
          return;
        }
        resolve(buf);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Token request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(params.toString());
    req.end();
  });
}

function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const fn = url.startsWith("https:") ? request : get;
    const req = fn(url, { timeout: timeoutMs, headers: { Accept: "application/json", "User-Agent": "toolify-cli", ...headers } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`Profile endpoint HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
          return;
        }
        resolve(buf);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Profile request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

function parseJson<T>(raw: string): T {
  try { return JSON.parse(raw) as T; }
  catch { throw new Error(`Auth provider returned invalid JSON: ${raw.slice(0, 200)}`); }
}

export const GOOGLE_PROVIDER: OAuthProvider = {
  id: "google",
  name: "Google",
  authorizeUrl: (redirectUri: URL): URL => {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: envClientId("google"),
      redirect_uri: redirectUri.href,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    }).toString();
    return u;
  },
  exchange: async (code: string, redirectUri: URL): Promise<AuthSession> => {
    const raw = await postJson("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri.href,
      client_id: envClientId("google"),
      client_secret: envClientSecret("google"),
    });
    const body = parseJson<{ access_token: string; refresh_token?: string; expires_in?: number }>(raw);
    if (!body.access_token) throw new Error("Google token exchange returned no access_token");
    const userInfo = parseJson<{
      sub?: string; email?: string; name?: string; picture?: string;
    }>(await getJson("https://www.googleapis.com/oauth2/v3/userinfo", {
      Authorization: `Bearer ${body.access_token}`,
    }));
    const expiresAt = body.expires_in && body.expires_in > 0 ? Date.now() + body.expires_in * 1000 : undefined;
    return {
      provider: "google",
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt,
      user: {
        provider: "google",
        id: userInfo.sub ?? "unknown",
        name: userInfo.name ?? "Google user",
        email: userInfo.email,
        avatarUrl: userInfo.picture,
      },
    };
  },
};

export const GITHUB_PROVIDER: OAuthProvider = {
  id: "github",
  name: "GitHub",
  authorizeUrl: (redirectUri: URL): URL => {
    const u = new URL("https://github.com/login/oauth/authorize");
    u.search = new URLSearchParams({
      client_id: envClientId("github"),
      redirect_uri: redirectUri.href,
      response_type: "code",
      scope: "read:user",
    }).toString();
    return u;
  },
  exchange: async (code: string, redirectUri: URL): Promise<AuthSession> => {
    const raw = await postForm("https://github.com/login/oauth/access_token", new Map([
      ["client_id", envClientId("github")],
      ["client_secret", envClientSecret("github")],
      ["code", code],
      ["redirect_uri", redirectUri.href],
    ]));
    const body = parseJson<{ access_token?: string; token_type?: string }>(raw);
    if (!body.access_token) throw new Error("GitHub token exchange returned no access_token");
    const user = parseJson<{
      id?: number; login?: string; name?: string; email?: string; avatar_url?: string;
    }>(await getJson("https://api.github.com/user", {
      Authorization: `Bearer ${body.access_token}`,
    }));
    return {
      provider: "github",
      accessToken: body.access_token,
      expiresAt: undefined,
      user: {
        provider: "github",
        id: String(user.id ?? "unknown"),
        name: user.name ?? user.login ?? "GitHub user",
        accountName: user.login,
        email: user.email,
        avatarUrl: user.avatar_url,
      },
    };
  },
};

export const KNOWN_PROVIDERS: OAuthProvider[] = [GOOGLE_PROVIDER, GITHUB_PROVIDER];

export function providerById(id: "google" | "github"): OAuthProvider {
  return KNOWN_PROVIDERS.find((p) => p.id === id) ?? (() => { throw new Error(`Unknown auth provider: ${id}`); })();
}
