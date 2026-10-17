/**
 * Word-editing helpers for terminal input strings.
 *
 * Ink's plain `useInput` does not expose cursor position, so these operate on
 * the whole `inputValue` string:
 *   - deleteWordLeft removes the last whitespace-delimited word
 *   - deleteWordRight removes trailing content after the cursor (treated as
 *     end-of-string for v1, since cursor-aware editing is deferred)
 */

export function deleteWordLeft(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length === 0) return text;
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return "";
  return trimmed.slice(0, lastSpace + 1);
}

export function deleteWordRight(text: string): string {
  const leading = text.replace(/^\s+/, "");
  if (leading.length === 0) return text;
  const firstSpace = leading.indexOf(" ");
  if (firstSpace === -1) return "";
  return text.slice(0, text.length - leading.length + firstSpace);
}