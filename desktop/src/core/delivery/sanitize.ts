// Makes spoken text safe to type into Claude's prompt (TECH_SPEC §4.5, measured in S5.3).

/** Past about 1 KB, Claude's input loses the start of the text and submits the rest. */
export const MAX_PROMPT_CHARS = 900

/**
 * Removes control characters and ESC, since a paste end marker in the text would break out of the
 * paste. A leading / or ! would run as a command or in a shell, and a space in front stops that.
 */
export function sanitizeForPrompt(text: string): string {
  const flat = text
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (/\s/u.test(char) ? ' ' : ''))
    .replace(/\s+/gu, ' ')
    .trim()
  return flat.startsWith('/') || flat.startsWith('!') ? ` ${flat}` : flat
}

/** Characters, not bytes: S5.3 measured 1109 bytes of Croatian arriving whole in 800 characters. */
export function isTooLongForPrompt(text: string): boolean {
  return text.length > MAX_PROMPT_CHARS
}

/**
 * Claude's own turns start with a tag such as <task-notification>, and aren't a delivery. A long
 * paste is wrapped in <pasted_content>, but that starts with newlines, so it doesn't match here.
 */
export function isClaudeOwnPrompt(prompt: string): boolean {
  return /^<[a-z][a-z-]*>/u.test(prompt)
}

/** The wrapper around a long paste is fine, as long as the text inside is whole. */
export function promptContains(prompt: string, text: string): boolean {
  return prompt.includes(text.trim())
}
