import type { HookMessage } from '../shared/hooks'
import type { MessageCode } from './messages'

// Failures Claude reports through its hooks while the user works (S7.2): each becomes one notice,
// at most once per command, so a turn full of failing browser calls says it once.

export type HookFailureCode = Extract<
  MessageCode,
  'CHROME_NOT_DETECTED' | 'CLAUDE_NOT_LOGGED_IN' | 'CLAUDE_TURN_FAILED'
>

/** A StopFailure's error is a short code from Claude, such as "authentication_failed". */
export function turnFailureCode(error: string | undefined): HookFailureCode {
  return error !== undefined && /auth/i.test(error) ? 'CLAUDE_NOT_LOGGED_IN' : 'CLAUDE_TURN_FAILED'
}

export class FailureNotices {
  private readonly shown = new Set<HookFailureCode>()

  /** The notice this hook calls for, or null. */
  onHook(message: HookMessage): HookFailureCode | null {
    if (message.kind !== 'hook') return null
    const { hook } = message
    switch (hook.hook_event_name) {
      case 'UserPromptSubmit':
      case 'SessionStart':
        this.shown.clear()
        return null
      case 'PostToolUse':
        return 'browserDisconnected' in hook ? this.once('CHROME_NOT_DETECTED') : null
      case 'StopFailure':
        return this.once(turnFailureCode(hook.error))
      default:
        return null
    }
  }

  private once(code: HookFailureCode): HookFailureCode | null {
    if (this.shown.has(code)) return null
    this.shown.add(code)
    return code
  }
}
