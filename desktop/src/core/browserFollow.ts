import type { HookMessage } from '../shared/hooks'
import type { ClaudeState } from './state/reducer'

/** Every tool from the Claude in Chrome extension is named with this (decision note S6.10). */
export const BROWSER_TOOL_PREFIX = 'mcp__claude-in-chrome__'

/**
 * Decides when to bring the browser forward: once for each command, when Claude's first browser
 * action has finished. Not when it starts, because a permission prompt for it would then open behind
 * the browser, which also takes the keyboard. For the same reason it waits while Claude is asking
 * something, and the next browser action tries again.
 */
export class BrowserFollow {
  private armed = true

  /** Call with the state after this hook. True means show the browser now. */
  onHook(message: HookMessage, state: ClaudeState): boolean {
    if (message.kind !== 'hook') return false
    const { hook } = message
    if (hook.hook_event_name === 'UserPromptSubmit' || hook.hook_event_name === 'SessionStart') {
      this.armed = true
      return false
    }
    if (hook.hook_event_name !== 'PostToolUse') return false
    if (hook.tool_name?.startsWith(BROWSER_TOOL_PREFIX) !== true) return false
    if (!this.armed || state === 'awaitingPermission' || state === 'awaitingInput') return false
    this.armed = false
    return true
  }
}
