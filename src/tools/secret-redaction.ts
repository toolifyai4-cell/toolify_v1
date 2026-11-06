/**
 * Secret Redaction Module
 * 
 * Detects and redacts API keys, tokens, and passwords from strings
 * to prevent accidental exposure to LLMs or in tool outputs.
 * 
 * Patterns cover major cloud providers, AI providers, and common
 * development secrets.
 */

// Core redaction function - replaces matched secrets with type indicator
export function redactSecrets(input: string, customPatterns?: RegExp[]): string {
  const patterns = getDefaultPatterns(customPatterns);
  let result = input;

  for (const pattern of patterns) {
    result = result.replace(pattern, (match: string) => {
      // Extract what kind of secret this is for logging purposes
      const type = classifySecretType(match);
      return `[REDACTED ${type}]`;
    });
  }

  return result;
}

// Default patterns for common secret types
function getDefaultPatterns(customPatterns?: RegExp[]): RegExp[] {
  const defaults = [
    // OpenAI API keys: sk-live_..., sk-proj-...
    /sk-[a-zA-Z0-9]{48}/g,
    // Anthropic API keys: antip-...
    /antisc-[a-zA-Z0-9]{40}/g,
    // Google API keys: AIza[0-9A-Za-z-_32 characters]
    /AIza[0-9A-Za-z-_]{32}/g,
    // AWS Access Key IDs: AKIA[0-9A-Z]{16}
    /AKIA[0-9A-Z]{16}/g,
    // AWS Secret Access Keys: [a-zA-Z0-9/+=]{40}
    /[a-zA-Z0-9/+=]{40}/g,
    // JWT tokens: eyJh... (start of token)
    /eyJ[a-zA-Z0-9_-]+\.?[a-zA-Z0-9_-]*/g,
    // Generic bearer tokens: very long alphanumeric strings after "Bearer"
    /Bearer [a-zA-Z0-9._-]{32,}/g,
    // Password patterns in quotes: "password" "pass" etc near = values
    /(?<=['"])([a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]{8,})(?=['"])/g,
    // Generic long alphanumeric strings that look like keys (16+ chars)
    /(?:^|[\\s(])[a-zA-Z0-9]{32,}(?:[\\s)]|$)/g,
  ];

  // Combine defaults with custom patterns, custom takes precedence for overlaps
  const allPatterns = [...defaults];
  if (customPatterns) {
    allPatterns.push(...customPatterns);
  }
  return allPatterns;
}

// Classify what type of secret was detected (for logging/auditing)
function classifySecretType(secret: string): string {
  const lower = secret.toLowerCase();

  if (lower.startsWith('sk-') || lower.startsWith('sk_live') || lower.startsWith('sk_test')) {
    return 'OPENAI_API_KEY';
  }
  if (lower.startsWith('ant')) {
    return 'ANTHROPIC_API_KEY';
  }
  if (lower.startsWith('aiza')) {
    return 'GOOGLE_API_KEY';
  }
  if (lower.startsWith('ak')) {
    return 'AWS_ACCESS_KEY';
  }
  if (lower.match(/^eyj/i)) {
    return 'JWT_TOKEN';
  }
  if (lower.length >= 40 && /[a-zA-Z0-9]/.test(lower)) {
    return 'LONG_TOKEN';
  }
  if (lower.includes('password') || lower.includes('pass')) {
    return 'PASSWORD';
  }
  return 'SECRET';
}

// Redact secrets from a ToolResult before it's sent to the LLM
export function redactToolResult(result: string): string {
  return redactSecrets(result);
}

// Redact secrets from model response before processing
export function redactModelResponse(response: string): string {
  return redactSecrets(response);
}

// Check if a string contains any secrets (quick scan)
export function hasSecrets(input: string): boolean {
  const patterns = getDefaultPatterns();
  return patterns.some((pattern) => pattern.test(input));
}

// Export common pattern constants for use in other modules
export const SECRET_PATTERNS = {
  openAI: /sk-[a-zA-Z0-9]{48}/g,
  anthropic: /antisc-[a-zA-Z0-9]{40}/g,
  google: /AIza[0-9A-Za-z-_]{32}/g,
  awsKey: /AKIA[0-9A-Z]{16}/g,
  jwt: /eyJ[a-zA-Z0-9_-]+\.?[a-zA-Z0-9_-]*/g,
};