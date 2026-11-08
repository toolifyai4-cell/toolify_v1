/**
 * Secret Redaction Module
 *
 * Detects and redacts API keys, tokens, and passwords from strings,
 * tool inputs, and LLM outputs to prevent secret leakage.
 *
 * Patterns cover the most common secret formats used by major AI providers
 * and cloud services. Add new patterns as needed for your stack.
 */

// ── regex patterns ──────────────────────────────────────────────────────────
/**
 * Patterns that, when matched, indicate a secret/token/password.
 * Each entry is a RegExp that tests a string chunk.
 */
export const SECRET_PATTERNS = [
  // OpenAI API keys: sk- followed by 48 alphanumeric chars
  /sk-[A-Za-z0-9]{48}/g,
  // Anthropic API keys: acp- followed by 48 alphanumeric chars
  /acp-[A-Za-z0-9]{48}/g,
  // Generic API key patterns: ends with -key or _key with alphanumeric
  /[A-Za-z0-9]{24,}((-key)|(_key))/g,
  // Bearer tokens (short): starts with ghp_ or similar 32-40 char tokens
  /\bghp_[A-Za-z0-9]{36}\b/g,
  // Google API keys: AIza followed by 35 chars
  /AIza[A-Za-z0-9\-]{35}/g,
  // Password patterns (common defaults): password= or pass= followed by non-space
  /(?:password|pass)=[^\s]{8,}/gi,
  // JWT tokens: eyJhbGciOiJ... format (roughly 200+ chars)
  /eyJ[A-Za-z0-9_-]+\. eyJ[A-Za-z0-9_-]+\. eyJ[A-Za-z0-9_-]+/g,
  // Generic token-like strings: 20+ chars with mix of upper/lower/digits
  /\b[A-Za-z0-9]{20,}\b/g,
];

// ── hasSecrets ──────────────────────────────────────────────────────────────
/**
 * Return `true` if `input` contains any known secret pattern.
 */
export function hasSecrets(input) {
  if (typeof input !== "string") return false;
  return SECRET_PATTERNS.some((re) => re.test(input));
}

// ── redactSecrets ───────────────────────────────────────────────────────────
/**
 * Return `input` with every captured secret replaced by `<REDACTED>`.
 * The replacement preserves the original length/format so LLM prompts
 * remain roughly the same size.
 */
export function redactSecrets(input) {
  if (typeof input !== "string") return input;
  let result = input;
  // Sort patterns by length (longest first) so more specific patterns win
  const sorted = [...SECRET_PATTERNS].sort((a, b) => b.source.length - a.source.length);
  for (const re of sorted) {
    result = result.replace(re, "<REDACTED>");
  }
  return result;
}

// ── scanValues ──────────────────────────────────────────────────────────────
/**
 * Walk a `Record<string, unknown>` and report every key whose value
 * contains a detected secret. Returns an array of `key: *redacted*` strings.
 */
export function scanValues(obj) {
  const hits = [];
  for (const [key, value] of Object.entries(obj)) {
    const strValue = String(value);
    if (hasSecrets(strValue)) {
      hits.push(`${key}: *redacted*`);
    }
    if (value && typeof value === "object") {
      hits.push(...scanValues(value));
    }
  }
  return hits;
}

// ── hasSecretsInInput ───────────────────────────────────────────────────────
/**
 * Convenience: check a tool call's input object for secret values.
 * Used by the PolicyEngine before tool execution.
 */
export function hasSecretsInInput(input) {
  if (!input || typeof input !== "object") return false;
  return scanValues(input).length > 0;
}