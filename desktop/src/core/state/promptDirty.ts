import type { ClaudeState } from './reducer'

// Whether the user may have text sitting in Claude's prompt (TECH_SPEC §4.4). Nothing reports what
// is there, and S5.3 found a paste merges with it and is sent, so this is deliberately pessimistic:
// a false "dirty" only blocks a voice send, while a false "clean" sends the wrong command.

// Terminal sequences start with ESC, so these have to match a control character.
/* eslint-disable no-control-regex */
const FOCUS_REPORT = /^\x1b\[[IO]$/u
const MOUSE_REPORT = /^(?:\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3})+$/u
const PAGE_KEYS = /^\x1b\[[56](?:;\d+)?~$/u
/* eslint-enable no-control-regex */
/**
 * Claude's own shortcuts that add no text: Shift+Tab, Ctrl+O and Ctrl+T. Not Right or Tab, which
 * can accept a grey suggestion into the prompt, where it would merge with a send.
 */
const UI_KEYS: ReadonlySet<string> = new Set(['\x1b[Z', '\x0f', '\x14'])

function isHarmless(data: string): boolean {
  return (
    UI_KEYS.has(data) || FOCUS_REPORT.test(data) || MOUSE_REPORT.test(data) || PAGE_KEYS.test(data)
  )
}

/** Keys at a permission prompt or dialog answer that, and don't reach the main prompt. */
function keysReachPrompt(state: ClaudeState): boolean {
  return state === 'idle' || state === 'busy' || state === 'unknown'
}

/** Enter, Esc and Ctrl+C add no text. Ctrl+C clears it: the tracker handles that. */
export function dirtyAfterInput(dirty: boolean, data: string, state: ClaudeState): boolean {
  if (data === '\r' || data === '\x1b' || isHarmless(data)) return dirty
  return keysReachPrompt(state) || dirty
}
