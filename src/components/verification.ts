/**
 * Post-execution verification report as clean markdown checkmarks:
 *   - [x] **typecheck** — `npx tsc --noEmit`
 *   - [ ] **lint** — `npx eslint .`
 * Rendered as an assistant message in the chat stream.
 */

export interface VerificationCheck {
  readonly name: string;
  readonly command: string;
  readonly passed: boolean;
}

export function buildVerificationReport(checks: readonly VerificationCheck[]): string {
  if (checks.length === 0) return "### Verification\n(no checks ran)";
  const lines = checks.map((c) => {
    const label = c.name && c.name !== c.command ? c.name : c.command;
    const suffix = label !== c.command ? ` — \`${c.command}\`` : "";
    return `- ${c.passed ? "[x]" : "[ ]"} **${label}**${suffix}`;
  });
  return ["### Verification", ...lines].join("\n");
}
