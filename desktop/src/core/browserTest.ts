import { BROWSER_NAVIGATE_TOOL, type HookMessage } from '../shared/hooks'
import type { BrowserTestStatus } from '../shared/ipcChannels'
import { MESSAGES } from './messages'
import type { ClaudeState } from './state/reducer'

export const BROWSER_TEST_PROMPT =
  'Use the browser to open https://example.com and tell me the page title. Reply with the title only.'
/** Long enough for a permission question, or Claude's one-time "use my browser" question. */
const TEST_TIMEOUT_MS = 120000
const START_TIMEOUT_MS = 120000

/** Claude in Chrome needs Claude Code 2.0.73 or newer (Claude Code's Chrome docs). */
export const CHROME_MIN_CLAUDE_VERSION = '2.0.73'

export interface BrowserTestDeps {
  /**
   * Turns browser control on and makes sure Claude runs with it: `fresh` when nothing was running
   * and Claude starts now, `restart` when the running one has to start again, `running` when it
   * already has it.
   */
  readonly startWithBrowser: () => 'fresh' | 'restart' | 'running'
  /** Through the send gate, so the text can't land in a prompt or question. */
  readonly deliver: (text: string) => void
  readonly discard: () => void
  readonly promptDirty: () => boolean
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly onChange: () => void
}

type Failure = Extract<BrowserTestStatus, { status: 'failed' }>

const failure = (title: string, detail: string): Failure => ({ status: 'failed', title, detail })
const notConnected = (): Failure =>
  failure(MESSAGES.BROWSER_NOT_CONNECTED.title, MESSAGES.BROWSER_NOT_CONNECTED.detail)

/**
 * The wizard's browser test (S6.9). Claude is asked to open a page, and the test passes only when
 * its navigate tool says the page opened. A browser that can't be reached still answers that tool
 * call normally, with the error as text, so no other tool call counts (recorded in S6.9).
 */
export class BrowserTest {
  private claude: ClaudeState = 'starting'
  private phase: 'ready' | 'starting' | 'testing' | 'passed' = 'ready'
  private sawStart = false
  private sawPrompt = false
  private failed: Failure | undefined
  private cancelTimer: (() => void) | undefined

  constructor(private readonly deps: BrowserTestDeps) {}

  get status(): BrowserTestStatus {
    if (this.phase !== 'ready') return { status: this.phase }
    return this.failed ?? { status: 'ready' }
  }

  get passed(): boolean {
    return this.phase === 'passed'
  }

  start(): void {
    if (this.phase !== 'ready') return
    this.failed = undefined
    const start = this.deps.startWithBrowser()
    if (start !== 'running') {
      this.phase = 'starting'
      // A restart passes through starting. A fresh start may already be there, with nothing idle.
      this.sawStart = start === 'fresh'
      this.setTimer(START_TIMEOUT_MS, () => {
        this.fail(failure('Claude didn’t start', 'Check the terminal, then test again.'))
      })
      this.deps.onChange()
      return
    }
    this.send()
  }

  onClaudeState(state: ClaudeState): void {
    this.claude = state
    if (this.phase === 'starting') {
      if (state === 'starting') this.sawStart = true
      // Only a session that started after the restart has browser control.
      if (state === 'idle' && this.sawStart) this.send()
      return
    }
    if (this.phase === 'testing' && state === 'exited') {
      this.deps.discard()
      this.fail(failure('Claude closed', 'Restart Claude, then test again.'))
    }
  }

  onHook(message: HookMessage): void {
    if (this.phase !== 'testing' || message.kind !== 'hook') return
    const { hook } = message
    if (hook.hook_event_name === 'UserPromptSubmit') this.sawPrompt = true
    if (!this.sawPrompt) return
    if (
      hook.hook_event_name === 'PostToolUse' &&
      hook.tool_name === BROWSER_NAVIGATE_TOOL &&
      'navigated' in hook
    ) {
      this.clearTimer()
      this.phase = 'passed'
      this.deps.onChange()
    } else if (hook.hook_event_name === 'Stop' || hook.hook_event_name === 'StopFailure') {
      this.fail(notConnected())
    }
  }

  private send(): void {
    if (this.claude !== 'idle') {
      this.fail(failure('Claude isn’t ready', 'Wait until it is, then test again.'))
      return
    }
    if (this.deps.promptDirty()) {
      this.fail(
        failure(
          'There is text in the terminal',
          'Clear what is typed at Claude’s prompt, then test again.'
        )
      )
      return
    }
    this.phase = 'testing'
    this.sawPrompt = false
    this.setTimer(TEST_TIMEOUT_MS, () => {
      this.deps.discard()
      this.fail(notConnected())
    })
    this.deps.onChange()
    this.deps.deliver(BROWSER_TEST_PROMPT)
  }

  private setTimer(ms: number, callback: () => void): void {
    this.clearTimer()
    this.cancelTimer = this.deps.schedule(callback, ms)
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
  }

  private fail(failed: Failure): void {
    this.clearTimer()
    this.phase = 'ready'
    this.failed = failed
    this.deps.onChange()
  }
}
