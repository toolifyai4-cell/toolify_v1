import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { execFile } from "node:child_process";
import type { OAuthProvider } from "./types.js";

const PREFERRED_PORTS = [18432, 18433, 18434, 18435];

const PAGE_STYLE =
  `:root{color-scheme:dark}` +
  `*{box-sizing:border-box;margin:0;padding:0}` +
  `body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;` +
  `min-height:100vh;display:flex;align-items:center;justify-content:center;` +
  `background:radial-gradient(1200px 600px at 50% -10%,#12324a 0%,#0d1117 55%,#0d1117 100%);` +
  `color:#e6edf3;padding:24px}` +
  `.card{width:min(480px,100%);background:#161b22;border:1px solid #30363d;border-radius:16px;` +
  `padding:40px 36px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.5)}` +
  `.logo{font-size:13px;letter-spacing:.35em;color:#39c5cf;font-weight:700;margin-bottom:20px}` +
  `.badge{width:72px;height:72px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;` +
  `justify-content:center}` +
  `.badge.ok{background:linear-gradient(135deg,#238636,#2ea043);box-shadow:0 0 0 8px rgba(46,160,67,.15)}` +
  `.badge.err{background:linear-gradient(135deg,#9e2b25,#da3633);box-shadow:0 0 0 8px rgba(218,54,51,.15)}` +
  `.badge svg{width:36px;height:36px;stroke:#fff;stroke-width:3;fill:none;` +
  `stroke-linecap:round;stroke-linejoin:round}` +
  `h1{font-size:24px;font-weight:700;margin-bottom:8px}` +
  `.sub{color:#8b949e;font-size:15px;line-height:1.55;margin-bottom:24px}` +
  `.codebox{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 14px;` +
  `font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#e6edf3;word-break:break-word;` +
  `margin:0 auto 24px;max-width:400px}` +
  `.kbd{display:inline-block;background:#0d1117;border:1px solid #30363d;border-bottom-width:2px;` +
  `border-radius:6px;padding:1px 8px;font-family:ui-monospace,Consolas,monospace;font-size:13px}` +
  `.tips{list-style:none;text-align:left;margin:0 auto 24px;max-width:360px;` +
  `display:flex;flex-direction:column;gap:10px}` +
  `.tips li{display:flex;align-items:center;gap:10px;color:#8b949e;font-size:13.5px}` +
  `.tips .dot{width:8px;height:8px;border-radius:50%;flex:none;` +
  `background:linear-gradient(135deg,#39c5cf,#2ea043);box-shadow:0 0 8px rgba(57,197,207,.5)}` +
  `.foot{margin-top:24px;padding-top:16px;border-top:1px solid #21262d;color:#6e7681;font-size:12.5px}`;

function successPage(providerName: string): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>TOOLIFY - Signed in with ${providerName}</title>` +
    `<style>${PAGE_STYLE}</style></head><body><main class="card">` +
    `<div class="logo">TOOLIFY</div>` +
    `<div class="badge ok"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg></div>` +
    `<h1>Signed in with ${providerName}</h1>` +
    `<p class="sub">You are all set. Head back to your terminal - your session is ` +
    `ready and the setup will continue automatically.</p>` +
    `<ul class="tips">` +
    `<li><span class="dot"></span>Plan vs Act modes - explore safely, then build boldly</li>` +
    `<li><span class="dot"></span>Verification gate - TOOLIFY proves its work with your tests</li>` +
    `<li><span class="dot"></span>Checkpoints - every step snapshotted, nothing lost</li>` +
    `</ul>` +
    `<p class="sub">You can safely close this tab <span class="kbd">Ctrl</span> + ` +
    `<span class="kbd">W</span>.</p>` +
    `<div class="foot">TOOLIFY &middot; your AI coding agent in the terminal</div>` +
    `</main></body></html>`
  );
}

function errorPage(providerName: string, error: string, detail: string): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>TOOLIFY - Sign-in failed</title>` +
    `<style>${PAGE_STYLE}</style></head><body><main class="card">` +
    `<div class="logo">TOOLIFY</div>` +
    `<div class="badge err"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></div>` +
    `<h1>Sign-in with ${providerName} failed</h1>` +
    `<p class="sub">The provider sent back an error instead of an authorization code. ` +
    `Return to your terminal - error details below, ` +
    `and check the terminal output for the full message.</p>` +
    `<div class="codebox">${escapeHtml(error)}${detail ? ` - ${escapeHtml(detail)}` : ""}</div>` +
    `<div class="foot">TOOLIFY &middot; your AI coding agent in the terminal</div>` +
    `</main></body></html>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface CallbackResult {
  readonly code?: string;
  readonly error?: string;
  readonly errorDescription?: string;
}

function parseCallback(req: IncomingMessage): CallbackResult {
  const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (u.pathname !== "/callback") return {};
  return {
    code: u.searchParams.get("code") ?? undefined,
    error: u.searchParams.get("error") ?? undefined,
    errorDescription: u.searchParams.get("error_description") ?? undefined,
  };
}


/**
 * Local callback server: waits for the provider redirect to /callback.
 * Fires onResult exactly once: code on success, error on access_denied etc.
 */
export async function startCallbackServer(
  provider: OAuthProvider,
  onResult: (result: CallbackResult) => void,
  timeoutMs: number = 5 * 60 * 1000,
): Promise<{ server: Server; port: number }> {
  void timeoutMs;
  let port: number | undefined;
  let server: Server | null = null;
  let settled = false;

  const settle = (res: ServerResponse, result: CallbackResult): void => {
    const html = result.code !== undefined
      ? successPage(provider.name)
      : errorPage(provider.name, result.error ?? "unknown_error", result.errorDescription ?? "");
    if (settled) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    settled = true;
    onResult(result);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  };

  for (const tryPort of PREFERRED_PORTS) {
    const s = createServer((req: IncomingMessage, res: ServerResponse) => {
      const parsed = parseCallback(req);
      if (parsed.code !== undefined || parsed.error !== undefined) {
        settle(res, parsed);
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    const bound = await new Promise<boolean>((resolve, reject) => {
      s.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" || err.code === "ECONNRESET") {
          s.close();
          resolve(false);
        } else {
          reject(err);
        }
      });
      s.listen(tryPort, "127.0.0.1", () => {
        port = tryPort;
        server = s;
        resolve(true);
      });
    });
    if (bound) break;
  }

  if (port === undefined || server === null) {
    throw new Error(`Could not bind a local callback port (${PREFERRED_PORTS.join(", ")}).`);
  }
  return { server, port };
}

/** Open the default browser (rundll32 first on Windows), print URL fallback. */
export function openAuthorizeUrl(authorizeUrl: URL): void {
  const url = authorizeUrl.toString();

  const attempts: Array<{ cmd: string; args: string[]; label: string }> =
    process.platform === "win32"
      ? [
          { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url], label: "rundll32" },
          { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", `Start-Process "${url}"`], label: "powershell" },
        ]
      : process.platform === "darwin"
        ? [{ cmd: "open", args: [url], label: "open" }]
        : [{ cmd: "xdg-open", args: [url], label: "xdg-open" }];

  const tryAt = (i: number): void => {
    const next = attempts[i];
    if (next === undefined) return;
    execFile(next.cmd, next.args, { windowsHide: false }, (err) => {
      if (err) tryAt(i + 1);
    });
  };
  tryAt(0);
}
