import type { HookMessage } from '../../shared/hooks'
import { BLOCK_MESSAGES, gate, type GateDecision } from '../gate/gate'
import type { MessageCode } from '../messages'
import type { ClaudeState } from '../state/reducer'
import {
  isClaudeOwnPrompt,
  isTooLongForPrompt,
  promptContains,
  sanitizeForPrompt
} from './sanitize'

// Gets a transcript into Claude's prompt, or holds it for a retry (TECH_SPEC §4.5). The gate decides
// every time, and is asked again just before Enter: a prompt that opened in the gap would otherwise
// be answered by that Enter, which is the failure S2.1 found.

export const ENTER_DELAY_MS = 250
export const CONFIRM_TIMEOUT_MS = 10000
export const HOLD_MS = 30000

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const ENTER = '\r'
const ESC = '\x1b'

export interface DeliveryOptions {
  readonly claude: {
    readonly state: ClaudeState
    readonly promptDirty: boolean
    markPromptDirty(): void
    deliveryTimeout(): void
    /** Tells the state tracker a key was pressed on Claude's behalf. */
    onInput(data: string): void
  }
  /** Straight to the PTY. */
  readonly write: (data: string) => void
  /** Returns a function that cancels it. Injected so this stays free of timers. */
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly overlay: {
    blocked(reason: string): void
    failed(code: MessageCode): void
    finished(): void
  }
  /** Esc, held only while there is a blocked transcript to discard. */
  readonly escape: { hold(onPress: () => void): void; release(): void }
}

export class Delivery {
  /** The blocked transcript: in memory only, and never logged or written to disk. */
  private held: string | undefined
  private cancelHold: (() => void) | undefined
  private cancelEnter: (() => void) | undefined
  private cancelConfirm: (() => void) | undefined
  /** Set from the paste until Claude confirms. Counts as busy, so two sends can't overlap. */
  private sending: string | undefined

  constructor(private readonly options: DeliveryOptions) {}

  get holding(): boolean {
    return this.held !== undefined
  }

  deliver(raw: string): void {
    const text = sanitizeForPrompt(raw)
    if (isTooLongForPrompt(text)) {
      // Never cut: it would send a command the user didn't say.
      this.options.overlay.failed('TRANSCRIPT_TOO_LONG')
      return
    }
    this.attempt(text)
  }

  /** The hotkey, while a transcript is held. Its 30 s keep counting from when it was blocked. */
  retry(): void {
    if (this.held !== undefined) this.attempt(this.held)
  }

  /** Esc, while a transcript is held. */
  discard(): void {
    if (!this.holding) return
    this.clearHold()
    this.options.overlay.finished()
  }

  onHook(message: HookMessage): void {
    if (message.kind !== 'hook' || message.hook.hook_event_name !== 'UserPromptSubmit') return
    const { sending } = this
    if (sending === undefined) return
    const { prompt } = message.hook
    // A finished background agent starts its own turn, which says nothing about this delivery.
    if (prompt !== undefined && isClaudeOwnPrompt(prompt)) return
    this.finishSending()
    if (prompt !== undefined && !promptContains(prompt, sending)) {
      // Claude is already acting on something the user never said, so it has to stop now.
      this.options.write(ESC)
      this.options.claude.onInput(ESC)
      this.options.overlay.failed('DELIVERY_GARBLED')
    }
  }

  /** The session went away, so nothing will ever confirm what was being sent. */
  sessionEnded(): void {
    this.finishSending()
  }

  private decide(): GateDecision {
    const { state, promptDirty } = this.options.claude
    return gate({
      state,
      promptDirty,
      deliveryPending: this.sending !== undefined,
      queueLength: 0,
      // S5.5 brings the queue. Until then, text spoken while Claude works is held for a retry.
      queueEnabled: false,
      maxQueue: 0
    })
  }

  private attempt(text: string): void {
    const decision = this.decide()
    if (decision.action === 'block') {
      this.hold(text, BLOCK_MESSAGES[decision.reason])
      return
    }
    this.clearHold()
    this.send(text)
  }

  private hold(text: string, reason: string): void {
    const { overlay, escape, schedule } = this.options
    overlay.blocked(reason)
    if (this.holding) return
    this.held = text
    escape.hold(() => {
      this.discard()
    })
    this.cancelHold = schedule(() => {
      this.discard()
    }, HOLD_MS)
  }

  private clearHold(): void {
    if (!this.holding) return
    this.cancelHold?.()
    this.cancelHold = undefined
    this.held = undefined
    this.options.escape.release()
  }

  private send(text: string): void {
    const { write, schedule, overlay } = this.options
    this.sending = text
    overlay.finished()
    write(`${PASTE_START}${text}${PASTE_END}`)
    this.cancelEnter = schedule(() => {
      this.cancelEnter = undefined
      this.pressEnter()
    }, ENTER_DELAY_MS)
  }

  private pressEnter(): void {
    const { write, schedule, claude } = this.options
    const { state, promptDirty } = claude
    // Asked afresh, and not through decide(), since this delivery itself is the pending one.
    if (state !== 'idle' || promptDirty) {
      // The text may be sitting in the prompt, and only the user can say what happens next.
      this.unconfirmed()
      return
    }
    write(ENTER)
    this.cancelConfirm = schedule(() => {
      this.cancelConfirm = undefined
      this.unconfirmed()
    }, CONFIRM_TIMEOUT_MS)
  }

  /** Never presses Enter again: if the first was only slow, it could answer whatever came next. */
  private unconfirmed(): void {
    const { claude, overlay } = this.options
    this.finishSending()
    claude.markPromptDirty()
    claude.deliveryTimeout()
    overlay.failed('DELIVERY_UNCONFIRMED')
  }

  private finishSending(): void {
    this.cancelEnter?.()
    this.cancelConfirm?.()
    this.cancelEnter = undefined
    this.cancelConfirm = undefined
    this.sending = undefined
  }
}
