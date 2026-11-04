import type { HookMessage } from '../../shared/hooks'
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

  constructor(private readonly options: TrackerOptions) {}

  get state(): ClaudeState {
    return this.context.state
  }

  /** The new session's state, at each launch. */
  sessionRestart(): void {
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
  }

  /** Every keystroke, before it reaches Claude. Never stored or logged. */
  onInput(data: string): void {
    if (data === ESC) this.dispatch({ type: 'userKey', key: 'esc' })
    else if (data === CTRL_C) this.dispatch({ type: 'userKey', key: 'ctrlC' })
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
