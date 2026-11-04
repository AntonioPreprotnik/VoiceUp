import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { BLOCK_MESSAGES } from '../gate/gate'
import type { ClaudeState } from '../state/reducer'
import { CONFIRM_TIMEOUT_MS, Delivery, ENTER_DELAY_MS, FLUSH_SETTLE_MS } from './delivery'

let delivery: Delivery
let written: string[]
let claude: {
  state: ClaudeState
  promptDirty: boolean
  markPromptDirty: Mock
  deliveryTimeout: Mock
  onInput: Mock
}
let overlay: { blocked: Mock; failed: Mock; finished: Mock; queued: Mock }
let settings: { queueEnabled: boolean; maxQueue: number }
let onQueueChange: Mock

const pasted = (text: string): string => `\x1b[200~${text}\x1b[201~`
const queuedTexts = (): string[] => delivery.queued.map(({ text }) => text)

function confirm(prompt: string): void {
  delivery.onHook({ kind: 'hook', hook: { hook_event_name: 'UserPromptSubmit', prompt } })
}

/** What Claude's hooks and the state tracker do together, when it finishes a turn. */
function claudeGoesIdle(): void {
  claude.state = 'idle'
  delivery.kick()
}

/** A send that has been pasted, had Enter pressed, and been confirmed. */
function completeSend(text: string): void {
  vi.advanceTimersByTime(ENTER_DELAY_MS)
  claude.state = 'busy'
  confirm(text)
}

beforeEach(() => {
  vi.useFakeTimers()
  written = []
  claude = {
    state: 'busy',
    promptDirty: false,
    markPromptDirty: vi.fn(),
    deliveryTimeout: vi.fn(),
    onInput: vi.fn()
  }
  overlay = { blocked: vi.fn(), failed: vi.fn(), finished: vi.fn(), queued: vi.fn() }
  settings = { queueEnabled: true, maxQueue: 3 }
  onQueueChange = vi.fn()
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
    escape: { hold: vi.fn(), release: vi.fn() },
    settings: () => settings,
    onQueueChange
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('while Claude works', () => {
  it('queues the text, writes nothing, and says so', () => {
    delivery.deliver('first')
    expect(queuedTexts()).toEqual(['first'])
    expect(written).toEqual([])
    expect(overlay.queued).toHaveBeenCalledWith(1)
    expect(delivery.holding).toBe(false)
  })

  it('reports each change to the queue, for the status bar', () => {
    delivery.deliver('first')
    expect(onQueueChange).toHaveBeenCalledOnce()
  })

  it('gives each item its own id', () => {
    delivery.deliver('same')
    delivery.deliver('same')
    expect(delivery.queued.at(0)?.id).not.toBe(delivery.queued.at(1)?.id)
  })

  it('queues sanitized text', () => {
    delivery.deliver('/clear')
    expect(queuedTexts()).toEqual([' /clear'])
  })

  it('does not queue text over the limit', () => {
    delivery.deliver('x'.repeat(901))
    expect(queuedTexts()).toEqual([])
    expect(overlay.failed).toHaveBeenCalledWith('TRANSCRIPT_TOO_LONG')
  })
})

describe('the limit', () => {
  it('holds text for a retry when the queue is full', () => {
    settings = { queueEnabled: true, maxQueue: 2 }
    delivery.deliver('one')
    delivery.deliver('two')
    delivery.deliver('three')
    expect(queuedTexts()).toEqual(['one', 'two'])
    expect(overlay.blocked).toHaveBeenCalledWith(BLOCK_MESSAGES.queueFull)
    expect(delivery.holding).toBe(true)
  })

  it('takes a held text once there is room, on a retry', () => {
    settings = { queueEnabled: true, maxQueue: 1 }
    delivery.deliver('one')
    delivery.deliver('two')
    delivery.cancelQueued(delivery.queued[0]?.id ?? '')
    delivery.retry()
    expect(queuedTexts()).toEqual(['two'])
    expect(delivery.holding).toBe(false)
  })
})

describe('with queueing off', () => {
  it('blocks instead', () => {
    settings = { queueEnabled: false, maxQueue: 3 }
    delivery.deliver('first')
    expect(queuedTexts()).toEqual([])
    expect(overlay.blocked).toHaveBeenCalledWith(BLOCK_MESSAGES.busy)
    expect(delivery.holding).toBe(true)
  })
})

describe('when Claude goes idle', () => {
  it('sends the first item only after a moment, not while the turn is ending', () => {
    delivery.deliver('first')
    claudeGoesIdle()
    expect(written).toEqual([])
    vi.advanceTimersByTime(FLUSH_SETTLE_MS - 1)
    expect(written).toEqual([])
    vi.advanceTimersByTime(1)
    expect(written).toEqual([pasted('first')])
    expect(queuedTexts()).toEqual([])
  })

  it('presses Enter the usual 250 ms later', () => {
    delivery.deliver('first')
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS + ENTER_DELAY_MS)
    expect(written).toEqual([pasted('first'), '\r'])
  })

  it('sends one at a time, in order, each waiting for the next idle', () => {
    delivery.deliver('first')
    delivery.deliver('second')
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([pasted('first')])

    completeSend('first')
    vi.advanceTimersByTime(FLUSH_SETTLE_MS * 10)
    expect(written).toEqual([pasted('first'), '\r'])
    expect(queuedTexts()).toEqual(['second'])

    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written.at(-1)).toBe(pasted('second'))
    expect(queuedTexts()).toEqual([])
  })

  it('does not send if Claude got busy again during the moment', () => {
    delivery.deliver('first')
    claudeGoesIdle()
    claude.state = 'busy'
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([])
    expect(queuedTexts()).toEqual(['first'])
  })

  it('does not disturb what the user is looking at', () => {
    delivery.deliver('first')
    overlay.finished.mockClear()
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(overlay.finished).not.toHaveBeenCalled()
  })

  it('starts only one wait, however many times it is told', () => {
    delivery.deliver('first')
    claudeGoesIdle()
    claudeGoesIdle()
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([pasted('first')])
  })

  it('does nothing with an empty queue', () => {
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([])
  })
})

// The queue must never be what puts text into a prompt: S2.1's hole, from another direction.
describe.each<ClaudeState>([
  'awaitingPermission',
  'awaitingInput',
  'unknown',
  'starting',
  'exited'
])('while %s', (state) => {
  it('stays queued, and goes once Claude is really idle', () => {
    delivery.deliver('first')
    claude.state = state
    delivery.kick()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS * 10)
    expect(written).toEqual([])
    expect(queuedTexts()).toEqual(['first'])

    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([pasted('first')])
  })
})

describe('text typed at the prompt', () => {
  it('holds the queue, until it is cleared', () => {
    delivery.deliver('first')
    claude.promptDirty = true
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS * 10)
    expect(written).toEqual([])

    claude.promptDirty = false
    delivery.kick()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([pasted('first')])
  })

  it('stops a send already waiting for its moment', () => {
    delivery.deliver('first')
    claudeGoesIdle()
    claude.promptDirty = true
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([])
  })
})

describe('order', () => {
  // Otherwise a command said at the wrong moment would overtake the ones before it.
  it('keeps new text behind the queue, even with Claude idle', () => {
    delivery.deliver('first')
    claude.state = 'idle'
    delivery.deliver('second')
    expect(written).toEqual([])
    expect(queuedTexts()).toEqual(['first', 'second'])
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([pasted('first')])
  })

  it('queues text said while a send is unconfirmed, and sends it after', () => {
    claude.state = 'idle'
    delivery.deliver('first')
    delivery.deliver('second')
    expect(written).toEqual([pasted('first')])
    expect(queuedTexts()).toEqual(['second'])
    completeSend('first')
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written.at(-1)).toBe(pasted('second'))
  })

  it('sends right away with an empty queue and Claude idle', () => {
    claude.state = 'idle'
    delivery.deliver('first')
    expect(written).toEqual([pasted('first')])
    expect(overlay.queued).not.toHaveBeenCalled()
  })
})

describe('cancelling', () => {
  it('removes just that item', () => {
    delivery.deliver('first')
    delivery.deliver('second')
    delivery.deliver('third')
    onQueueChange.mockClear()
    delivery.cancelQueued(delivery.queued[1]?.id ?? '')
    expect(queuedTexts()).toEqual(['first', 'third'])
    expect(onQueueChange).toHaveBeenCalledOnce()
  })

  it('means it is never sent', () => {
    delivery.deliver('first')
    delivery.cancelQueued(delivery.queued[0]?.id ?? '')
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS * 10)
    expect(written).toEqual([])
  })

  it('ignores an id that has already gone', () => {
    delivery.deliver('first')
    onQueueChange.mockClear()
    delivery.cancelQueued('nope')
    expect(queuedTexts()).toEqual(['first'])
    expect(onQueueChange).not.toHaveBeenCalled()
  })
})

describe('a new session', () => {
  it('clears the queue: those commands were meant for the old one', () => {
    delivery.deliver('first')
    delivery.deliver('second')
    onQueueChange.mockClear()
    delivery.sessionRestarted()
    expect(queuedTexts()).toEqual([])
    expect(onQueueChange).toHaveBeenCalledOnce()
    claudeGoesIdle()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS * 10)
    expect(written).toEqual([])
  })

  it('cancels a send waiting for its moment', () => {
    delivery.deliver('first')
    claudeGoesIdle()
    delivery.sessionRestarted()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS)
    expect(written).toEqual([])
  })

  it('keeps the queue when the session only ended, until it restarts', () => {
    delivery.deliver('first')
    delivery.sessionEnded()
    expect(queuedTexts()).toEqual(['first'])
  })
})

describe('a failed send', () => {
  it('does not send the next one after an unconfirmed delivery', () => {
    claude.state = 'idle'
    delivery.deliver('first')
    delivery.deliver('second')
    vi.advanceTimersByTime(ENTER_DELAY_MS + CONFIRM_TIMEOUT_MS)
    expect(overlay.failed).toHaveBeenCalledWith('DELIVERY_UNCONFIRMED')
    // The fake doesn't move state by itself, so this is what the tracker would report.
    claude.state = 'unknown'
    claude.promptDirty = true
    delivery.kick()
    vi.advanceTimersByTime(FLUSH_SETTLE_MS * 10)
    expect(written).toEqual([pasted('first'), '\r'])
    expect(queuedTexts()).toEqual(['second'])
  })
})
