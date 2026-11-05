import type { HookMessage } from '../shared/hooks'
import type { SignInStatus } from '../shared/ipcChannels'
import { MESSAGES } from './messages'
import type { ClaudeState } from './state/reducer'

export const TEST_PROMPT = 'reply with OK'
const TEST_TIMEOUT_MS = 120000

export interface SignInDeps {
  /** Through the send gate, so the text can't land in a login or trust prompt. */
  readonly deliver: (text: string) => void
  /** Drops a test the gate is holding, once it has timed out. */
  readonly discard: () => void
  readonly promptDirty: () => boolean
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly onChange: () => void
}

type Failure = Extract<SignInStatus, { status: 'failed' }>

function failure(title: string, detail: string, canTest: boolean): Failure {
  return { status: 'failed', title, detail, canTest }
}

/**
 * The wizard's Sign in step. It only watches Claude and sends one test, never touching the login:
 * the step is done when the test prompt gets a Stop hook (S6.4).
 */
export class SignInStep {
  private claude: ClaudeState = 'starting'
  private testing = false
  private sawPrompt = false
  private done = false
  private failed: Failure | undefined
  private cancelTimer: (() => void) | undefined

  constructor(private readonly deps: SignInDeps) {}

  get status(): SignInStatus {
    if (this.done) return { status: 'done' }
    if (this.testing) return { status: 'testing' }
    if (this.failed !== undefined) return { ...this.failed, canTest: this.claude === 'idle' }
    return { status: this.claude === 'idle' ? 'ready' : 'waiting' }
  }

  get isDone(): boolean {
    return this.done
  }

  onClaudeState(state: ClaudeState): void {
    this.claude = state
    if (this.testing && state === 'exited') {
      this.fail(failure('Claude closed', 'Restart Claude, then test again.', false))
      return
    }
    if (this.testing && state === 'unknown') {
      this.fail(
        failure(
          'Claude didn’t take the test',
          'If its prompt is empty, choose Re-arm voice in the terminal window, then test again. Or restart Claude.',
          false
        )
      )
      return
    }
    this.deps.onChange()
  }

  onHook(message: HookMessage): void {
    if (!this.testing || message.kind !== 'hook') return
    const { hook } = message
    if (hook.hook_event_name === 'UserPromptSubmit') this.sawPrompt = true
    if (!this.sawPrompt) return
    if (hook.hook_event_name === 'Stop') {
      this.endTest()
      this.done = true
      this.failed = undefined
      this.deps.onChange()
    } else if (hook.hook_event_name === 'StopFailure') {
      this.fail(failureFromError(hook.error))
    }
  }

  test(): void {
    if (this.done || this.testing || this.claude !== 'idle') return
    if (this.deps.promptDirty()) {
      this.fail(
        failure(
          'There is text in the terminal',
          'Clear what is typed at Claude’s prompt, then test again.',
          true
        )
      )
      return
    }
    this.failed = undefined
    this.testing = true
    this.sawPrompt = false
    this.cancelTimer = this.deps.schedule(() => {
      this.deps.discard()
      this.fail(failure('Claude didn’t answer', 'Check the terminal, then test again.', true))
    }, TEST_TIMEOUT_MS)
    this.deps.onChange()
    this.deps.deliver(TEST_PROMPT)
  }

  private endTest(): void {
    this.testing = false
    this.cancelTimer?.()
    this.cancelTimer = undefined
  }

  private fail(failed: Failure): void {
    this.endTest()
    this.failed = failed
    this.deps.onChange()
  }
}

/** Only a short code from Claude is ever shown. Anything else might quote more than it should. */
function failureFromError(error: string | undefined): Failure {
  if (error !== undefined && /auth/i.test(error)) {
    const { title, detail } = MESSAGES.CLAUDE_NOT_LOGGED_IN
    return failure(title, detail, true)
  }
  const code = /^[a-z_]{1,40}$/.test(error ?? '') ? ` (${String(error)})` : ''
  return failure('Claude couldn’t answer', `Check the terminal, then test again.${code}`, true)
}
