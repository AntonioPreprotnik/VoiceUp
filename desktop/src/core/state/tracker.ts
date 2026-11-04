import type { HookEvent, HookMessage } from '../../shared/hooks'
import { dirtyAfterInput } from './promptDirty'
import { isClaudeOwnPrompt } from '../delivery/sanitize'
import {
  INITIAL_STATE,
  reduce,
  type ClaudeState,
  type StateContext,
  type StateEffect,
  type StateEvent
} from './reducer'

const ENTER = '\r'
const ESC = '\x1b'
const CTRL_C = '\x03'
/** S2.1 measured Enter to UserPromptSubmit at 30-80 ms. */
export const LOCAL_UI_WAIT_MS = 1000

export interface TrackerOptions {
  /** Returns a function that cancels it. Injected so this stays free of timers and I/O. */
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly onChange: (state: ClaudeState, previous: ClaudeState) => void
  readonly onEffect: (effect: StateEffect) => void
}

/** Holds the one current state, feeds it, and watches for an Enter that no hook answers (§4.4). */
export class ClaudeStateTracker {
  private context: StateContext = INITIAL_STATE
  private cancelWatch: (() => void) | undefined
  private dirty = false

  constructor(private readonly options: TrackerOptions) {}

  get state(): ClaudeState {
    return this.context.state
  }

  /** The user may have unsent text in Claude's prompt, which a send would merge with. */
  get promptDirty(): boolean {
    return this.dirty
  }

  /** A delivery may have left its text there. */
  markPromptDirty(): void {
    this.dirty = true
  }

  /** The new session's state, at each launch. */
  sessionRestart(): void {
    this.dirty = false
    this.stopWatching()
    this.dispatch({ type: 'sessionRestart' })
  }

  ptyExit(): void {
    this.stopWatching()
    this.dispatch({ type: 'ptyExit' })
  }

  /** Ignored unless unknown: a click on a stale button must not change anything. */
  reArm(): void {
    if (this.context.state !== 'unknown') return
    // The user is saying the prompt is ready. /model and /login fire no hook, so nothing else can
    // say their text has gone.
    this.dirty = false
    this.stopWatching()
    this.dispatch({ type: 'reArm' })
  }

  deliveryTimeout(): void {
    this.dispatch({ type: 'deliveryTimeout' })
  }

  onHook(message: HookMessage): void {
    if (message.kind === 'unexpected') {
      this.dispatch({ type: 'unexpected' })
      return
    }
    // /clear stays idle throughout, so its Enter is answered only by this.
    if (message.hook.hook_event_name === 'SessionStart') this.stopWatching()
    this.dispatch({ type: 'hook', hook: message.hook })
    this.updateDirty(message.hook)
  }

  /** Claude's own turns submit nothing from the prompt, so only the user's clear it. */
  private updateDirty(hook: HookEvent): void {
    if (hook.hook_event_name === 'UserPromptSubmit') {
      if (hook.prompt === undefined || !isClaudeOwnPrompt(hook.prompt)) this.dirty = false
    } else if (hook.hook_event_name === 'SessionStart' && this.context.state === 'idle') {
      // Compaction leaves the prompt as it was.
      if (hook.source !== 'compact' && hook.source !== 'fork') this.dirty = false
    }
  }

  /** Every keystroke, before it reaches Claude. Never stored or logged. */
  onInput(data: string): void {
    if (data === CTRL_C) {
      // At the main prompt it clears the text. At anything else, the text is still there.
      const { state } = this.context
      if (state === 'idle' || state === 'unknown') this.dirty = false
      this.dispatch({ type: 'userKey', key: 'ctrlC' })
      return
    }
    this.dirty = dirtyAfterInput(this.dirty, data, this.context.state)
    if (data === ESC) this.dispatch({ type: 'userKey', key: 'esc' })
    else if (data === ENTER) this.watchEnter()
    else this.dispatch({ type: 'userKey', key: 'other' })
  }

  private watchEnter(): void {
    const { state } = this.context
    this.stopWatching()
    if (state !== 'idle' && state !== 'awaitingPermission') return
    this.cancelWatch = this.options.schedule(() => {
      this.cancelWatch = undefined
      this.dispatch({ type: 'localUiSuspected' })
    }, LOCAL_UI_WAIT_MS)
  }

  private stopWatching(): void {
    this.cancelWatch?.()
    this.cancelWatch = undefined
  }

  private dispatch(event: StateEvent): void {
    const previous = this.context.state
    const { context, effects } = reduce(this.context, event)
    this.context = context
    // Any change of state answered the Enter, even if it has already changed back by the deadline.
    if (context.state !== previous) {
      this.stopWatching()
      this.options.onChange(context.state, previous)
    }
    for (const effect of effects) this.options.onEffect(effect)
  }
}
