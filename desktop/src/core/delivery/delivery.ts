import type { HookMessage } from '../../shared/hooks'
import { BLOCK_MESSAGES, gate, type BlockReason, type GateDecision } from '../gate/gate'
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
/** After Claude goes idle: its Stop hook fires while the turn is still ending on screen. */
export const FLUSH_SETTLE_MS = 300

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
    /** Its place in the queue, from 1. */
    queued(position: number): void
  }
  /** Esc, held only while there is a blocked transcript to discard. */
  readonly escape: { hold(onPress: () => void): void; release(): void }
  readonly settings: () => { readonly queueEnabled: boolean; readonly maxQueue: number }
  /** For the status bar. */
  readonly onQueueChange: () => void
  /** For the log: a reason, and never the text. */
  readonly onBlocked: (reason: BlockReason) => void
}

export interface QueuedItem {
  readonly id: string
  readonly text: string
}

export class Delivery {
  /** The blocked transcript: in memory only, and never logged or written to disk. */
  private held: string | undefined
  private cancelHold: (() => void) | undefined
  private cancelEnter: (() => void) | undefined
  private cancelConfirm: (() => void) | undefined
  /** Set from the paste until Claude confirms. Counts as busy, so two sends can't overlap. */
  private sending: string | undefined
  /** In memory only, like a held transcript. */
  private queue: QueuedItem[] = []
  private nextId = 1
  private cancelFlush: (() => void) | undefined

  constructor(private readonly options: DeliveryOptions) {}

  get holding(): boolean {
    return this.held !== undefined
  }

  get queued(): readonly QueuedItem[] {
    return this.queue
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
    this.stopFlush()
  }

  /** A new session: whatever was queued was meant for the old one. */
  sessionRestarted(): void {
    this.sessionEnded()
    if (this.queue.length === 0) return
    this.queue = []
    this.options.onQueueChange()
  }

  cancelQueued(id: string): void {
    const remaining = this.queue.filter((item) => item.id !== id)
    if (remaining.length === this.queue.length) return
    this.queue = remaining
    this.options.onQueueChange()
  }

  /** Claude's state or the prompt changed, which may mean the next item can go. */
  kick(): void {
    if (this.cancelFlush !== undefined || !this.canFlush()) return
    this.cancelFlush = this.options.schedule(() => {
      this.cancelFlush = undefined
      this.flush()
    }, FLUSH_SETTLE_MS)
  }

  private stopFlush(): void {
    this.cancelFlush?.()
    this.cancelFlush = undefined
  }

  private canFlush(): boolean {
    if (this.queue.length === 0 || this.sending !== undefined) return false
    const { state, promptDirty } = this.options.claude
    const decision = gate({
      state,
      promptDirty,
      deliveryPending: false,
      queueLength: 0,
      queueEnabled: false,
      maxQueue: 0
    })
    return decision.action === 'send'
  }

  /** Asked afresh: a prompt can have opened, or typing started, during the wait. */
  private flush(): void {
    if (!this.canFlush()) return
    const next = this.queue.at(0)
    if (next === undefined) return
    this.queue = this.queue.slice(1)
    this.options.onQueueChange()
    this.send(next.text)
  }

  private decide(): GateDecision {
    const { state, promptDirty } = this.options.claude
    const { queueEnabled, maxQueue } = this.options.settings()
    return gate({
      state,
      promptDirty,
      // Items still waiting count too, or new text would overtake them.
      deliveryPending: this.sending !== undefined || this.queue.length > 0,
      queueLength: this.queue.length,
      queueEnabled,
      maxQueue
    })
  }

  private attempt(text: string): void {
    const decision = this.decide()
    if (decision.action === 'block') {
      this.options.onBlocked(decision.reason)
      this.hold(text, BLOCK_MESSAGES[decision.reason])
      return
    }
    const wasHeld = this.holding
    this.clearHold()
    if (decision.action === 'queue') {
      this.enqueue(text)
      return
    }
    // Only for text the user just let through: a queued one goes while they may be doing else.
    if (wasHeld) this.options.overlay.finished()
    this.send(text)
  }

  private enqueue(text: string): void {
    const { overlay, onQueueChange } = this.options
    this.queue.push({ id: String(this.nextId++), text })
    overlay.queued(this.queue.length)
    onQueueChange()
    this.kick()
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
    const { write, schedule } = this.options
    this.sending = text
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
