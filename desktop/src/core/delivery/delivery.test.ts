import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ClaudeState } from '../state/reducer'
import { BLOCK_MESSAGES } from '../gate/gate'
import { CONFIRM_TIMEOUT_MS, Delivery, ENTER_DELAY_MS, HOLD_MS } from './delivery'
import { MAX_PROMPT_CHARS } from './sanitize'

let delivery: Delivery
let written: string[]
let claude: {
  state: ClaudeState
  promptDirty: boolean
  markPromptDirty: Mock
  deliveryTimeout: Mock
  onInput: Mock
}
let overlay: { blocked: Mock; failed: Mock; finished: Mock }
let escape: { held: (() => void) | undefined; hold(onPress: () => void): void; release(): void }

const TEXT = 'run the tests'
const PASTED = `\x1b[200~${TEXT}\x1b[201~`

function confirm(prompt = TEXT): void {
  delivery.onHook({ kind: 'hook', hook: { hook_event_name: 'UserPromptSubmit', prompt } })
}

beforeEach(() => {
  vi.useFakeTimers()
  written = []
  claude = {
    state: 'idle',
    promptDirty: false,
    markPromptDirty: vi.fn(),
    deliveryTimeout: vi.fn(),
    onInput: vi.fn()
  }
  overlay = { blocked: vi.fn(), failed: vi.fn(), finished: vi.fn() }
  escape = {
    held: undefined,
    hold(onPress) {
      this.held = onPress
    },
    release() {
      this.held = undefined
    }
  }
  delivery = new Delivery({
    claude,
    write: (data) => written.push(data),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    overlay,
    escape
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sending', () => {
  it('pastes the text, and presses Enter separately 250 ms later', () => {
    delivery.deliver(TEXT)
    expect(written).toEqual([PASTED])
    vi.advanceTimersByTime(ENTER_DELAY_MS - 1)
    expect(written).toEqual([PASTED])
    vi.advanceTimersByTime(1)
    expect(written).toEqual([PASTED, '\r'])
  })

  it('sends sanitized text: nothing can break out of the paste', () => {
    delivery.deliver('run\x1b[201~\rtests')
    expect(written[0]).toBe('\x1b[200~run[201~ tests\x1b[201~')
  })

  it('puts a space before a command, so it stays text', () => {
    delivery.deliver('/clear')
    expect(written[0]).toBe('\x1b[200~ /clear\x1b[201~')
  })

  it('clears the overlay', () => {
    delivery.deliver(TEXT)
    expect(overlay.finished).toHaveBeenCalledOnce()
  })

  it('reports nothing once Claude confirms', () => {
    delivery.deliver(TEXT)
    vi.advanceTimersByTime(ENTER_DELAY_MS)
    confirm()
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS * 2)
    expect(overlay.failed).not.toHaveBeenCalled()
    expect(claude.deliveryTimeout).not.toHaveBeenCalled()
  })
})

describe('text over the limit', () => {
  it('is blocked and never cut: nothing at all is written', () => {
    delivery.deliver('x'.repeat(MAX_PROMPT_CHARS + 1))
    expect(written).toEqual([])
    expect(overlay.failed).toHaveBeenCalledWith('TRANSCRIPT_TOO_LONG')
    expect(delivery.holding).toBe(false)
  })

  it('goes through at the limit', () => {
    delivery.deliver('x'.repeat(MAX_PROMPT_CHARS))
    expect(written).toHaveLength(1)
  })
})

describe.each<[ClaudeState, string]>([
  ['awaitingPermission', BLOCK_MESSAGES.waitingForYou],
  ['awaitingInput', BLOCK_MESSAGES.waitingForYou],
  ['starting', BLOCK_MESSAGES.starting],
  ['exited', BLOCK_MESSAGES.exited],
  ['unknown', BLOCK_MESSAGES.unknown],
  ['busy', BLOCK_MESSAGES.busy]
])('while %s', (state, message) => {
  it('writes nothing, says why, and holds the text', () => {
    claude.state = state
    delivery.deliver(TEXT)
    vi.advanceTimersByTime(ENTER_DELAY_MS * 2)
    expect(written).toEqual([])
    expect(overlay.blocked).toHaveBeenCalledWith(message)
    expect(delivery.holding).toBe(true)
  })
})

describe('text the user has typed', () => {
  it('is never overwritten: the send is blocked', () => {
    claude.promptDirty = true
    delivery.deliver(TEXT)
    expect(written).toEqual([])
    expect(overlay.blocked).toHaveBeenCalledWith(BLOCK_MESSAGES.unsentText)
  })
})

// The hole from S2.1: a prompt opening in the 250 ms gap would be answered by that Enter.
describe('the gap between the paste and Enter', () => {
  it.each<ClaudeState>(['awaitingPermission', 'awaitingInput', 'busy', 'unknown', 'exited'])(
    'never presses Enter if Claude has moved to %s',
    (state) => {
      delivery.deliver(TEXT)
      claude.state = state
      vi.advanceTimersByTime(ENTER_DELAY_MS)
      expect(written).toEqual([PASTED])
      expect(overlay.failed).toHaveBeenCalledWith('DELIVERY_UNCONFIRMED')
      expect(claude.markPromptDirty).toHaveBeenCalledOnce()
    }
  )

  it('never presses Enter if the user started typing', () => {
    delivery.deliver(TEXT)
    claude.promptDirty = true
    vi.advanceTimersByTime(ENTER_DELAY_MS)
    expect(written).toEqual([PASTED])
    expect(overlay.failed).toHaveBeenCalledWith('DELIVERY_UNCONFIRMED')
  })
})

describe('a blocked transcript', () => {
  beforeEach(() => {
    claude.state = 'busy'
    delivery.deliver(TEXT)
  })

  it('offers Esc to discard it, for as long as it is held', () => {
    expect(escape.held).toBeDefined()
    escape.held?.()
    expect(delivery.holding).toBe(false)
    expect(overlay.finished).toHaveBeenCalledOnce()
    expect(escape.held).toBeUndefined()
    claude.state = 'idle'
    delivery.retry()
    expect(written).toEqual([])
  })

  it('goes through the gate again on a retry, and sends if now safe', () => {
    claude.state = 'idle'
    delivery.retry()
    expect(written).toEqual([PASTED])
    expect(delivery.holding).toBe(false)
    expect(escape.held).toBeUndefined()
  })

  it('stays held on a retry that is still blocked, with the new reason', () => {
    claude.state = 'awaitingPermission'
    delivery.retry()
    expect(written).toEqual([])
    expect(delivery.holding).toBe(true)
    expect(overlay.blocked).toHaveBeenLastCalledWith(BLOCK_MESSAGES.waitingForYou)
  })

  it('is gone after 30 s', () => {
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(delivery.holding).toBe(true)
    vi.advanceTimersByTime(1)
    expect(delivery.holding).toBe(false)
    expect(overlay.finished).toHaveBeenCalledOnce()
    expect(escape.held).toBeUndefined()
  })

  it('does not get more time from a retry', () => {
    vi.advanceTimersByTime(HOLD_MS - 1000)
    delivery.retry()
    vi.advanceTimersByTime(1000)
    expect(delivery.holding).toBe(false)
  })

  it('does not fire its timer after being sent', () => {
    claude.state = 'idle'
    delivery.retry()
    confirm()
    vi.advanceTimersByTime(HOLD_MS * 2)
    expect(overlay.finished).toHaveBeenCalledOnce()
  })
})

describe('confirmation', () => {
  const sent = (): void => {
    delivery.deliver(TEXT)
    vi.advanceTimersByTime(ENTER_DELAY_MS)
  }

  it('reports it unconfirmed after 10 s, and never presses Enter again', () => {
    sent()
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS - 1)
    expect(overlay.failed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(overlay.failed).toHaveBeenCalledWith('DELIVERY_UNCONFIRMED')
    expect(claude.deliveryTimeout).toHaveBeenCalledOnce()
    expect(claude.markPromptDirty).toHaveBeenCalledOnce()
    expect(written).toEqual([PASTED, '\r'])
  })

  it('accepts a slow confirmation: S5.3 measured up to 4.3 s', () => {
    sent()
    vi.advanceTimersByTime(4300)
    confirm()
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS)
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('accepts the wrapper around a long paste', () => {
    sent()
    confirm(`\n\n<pasted_content id="1">\n${TEXT}\n</pasted_content id="1">\n`)
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('does not count a background agent finishing as confirmation', () => {
    sent()
    confirm('<task-notification>agent done</task-notification>')
    expect(overlay.failed).not.toHaveBeenCalled()
    expect(written).toEqual([PASTED, '\r'])
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS)
    expect(overlay.failed).toHaveBeenCalledWith('DELIVERY_UNCONFIRMED')
  })

  it('interrupts Claude and says so when what arrived differs', () => {
    delivery.deliver("don't delete the database")
    vi.advanceTimersByTime(ENTER_DELAY_MS)
    written.length = 0
    confirm('delete the database')
    expect(written).toEqual(['\x1b'])
    expect(claude.onInput).toHaveBeenCalledWith('\x1b')
    expect(overlay.failed).toHaveBeenCalledWith('DELIVERY_GARBLED')
  })

  it('trusts a prompt it cannot read', () => {
    sent()
    delivery.onHook({ kind: 'hook', hook: { hook_event_name: 'UserPromptSubmit' } })
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS)
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('ignores prompts when nothing is being sent', () => {
    confirm('something the user typed')
    expect(written).toEqual([])
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('ignores other hooks and unexpected messages', () => {
    sent()
    delivery.onHook({ kind: 'hook', hook: { hook_event_name: 'Stop' } })
    delivery.onHook({ kind: 'unexpected', name: 'x', reason: 'unknown event' })
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS - 1)
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('holds a second send until the first is confirmed, so they can never overlap', () => {
    sent()
    written.length = 0
    delivery.deliver('second')
    expect(written).toEqual([])
    expect(delivery.holding).toBe(true)
    confirm()
    delivery.retry()
    expect(written).toEqual(['\x1b[200~second\x1b[201~'])
  })

  it('stops waiting when the session ends', () => {
    sent()
    delivery.sessionEnded()
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS)
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('does not press Enter into a session that ended in the gap', () => {
    delivery.deliver(TEXT)
    delivery.sessionEnded()
    vi.advanceTimersByTime(ENTER_DELAY_MS)
    expect(written).toEqual([PASTED])
  })
})
