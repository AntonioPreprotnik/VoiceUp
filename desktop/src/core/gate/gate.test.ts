import { describe, expect, it } from 'vitest'
import type { ClaudeState } from '../state/reducer'
import { BLOCK_MESSAGES, gate, type BlockReason, type GateInput } from './gate'

const STATES: readonly ClaudeState[] = [
  'starting',
  'idle',
  'busy',
  'awaitingPermission',
  'awaitingInput',
  'exited',
  'unknown'
]
const FLAGS = [false, true] as const
const MAX_QUEUE = 3

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    state: 'idle',
    promptDirty: false,
    deliveryPending: false,
    queueLength: 0,
    queueEnabled: true,
    maxQueue: MAX_QUEUE,
    ...overrides
  }
}

/** Every combination of every input, including a queue over its limit. */
const EVERY_INPUT: readonly GateInput[] = STATES.flatMap((state) =>
  FLAGS.flatMap((promptDirty) =>
    FLAGS.flatMap((deliveryPending) =>
      FLAGS.flatMap((queueEnabled) =>
        [0, 1, MAX_QUEUE - 1, MAX_QUEUE, MAX_QUEUE + 1].map((queueLength) =>
          input({ state, promptDirty, deliveryPending, queueEnabled, queueLength })
        )
      )
    )
  )
)

describe('every combination of inputs', () => {
  it('covers them all', () => {
    expect(EVERY_INPUT).toHaveLength(STATES.length * 2 * 2 * 2 * 5)
  })

  // The promise this whole milestone rests on.
  it('sends only when Claude is idle, the prompt is empty and nothing is pending', () => {
    for (const each of EVERY_INPUT) {
      const shouldSend = each.state === 'idle' && !each.promptDirty && !each.deliveryPending
      expect(gate(each).action === 'send', JSON.stringify(each)).toBe(shouldSend)
    }
  })

  it('queues only while Claude works, with queueing on and room left', () => {
    for (const each of EVERY_INPUT) {
      const working = each.state === 'busy' || (each.state === 'idle' && each.deliveryPending)
      const shouldQueue = working && each.queueEnabled && each.queueLength < MAX_QUEUE
      expect(gate(each).action === 'queue', JSON.stringify(each)).toBe(shouldQueue)
    }
  })

  it('always gives a block a reason with words to show', () => {
    for (const each of EVERY_INPUT) {
      const decision = gate(each)
      if (decision.action === 'block') expect(BLOCK_MESSAGES[decision.reason]).not.toBe('')
    }
  })
})

describe.each<[ClaudeState, BlockReason]>([
  ['awaitingPermission', 'waitingForYou'],
  ['awaitingInput', 'waitingForYou'],
  ['starting', 'starting'],
  ['exited', 'exited'],
  ['unknown', 'unknown']
])('while %s', (state, reason) => {
  it('blocks, whatever else is true', () => {
    for (const each of EVERY_INPUT.filter((candidate) => candidate.state === state)) {
      expect(gate(each)).toEqual({ action: 'block', reason })
    }
  })
})

describe('while idle', () => {
  it('sends', () => {
    expect(gate(input())).toEqual({ action: 'send' })
  })

  it('never overwrites text the user has typed', () => {
    expect(gate(input({ promptDirty: true }))).toEqual({ action: 'block', reason: 'unsentText' })
  })

  it('counts a pending delivery as busy, so two sends can never overlap', () => {
    expect(gate(input({ deliveryPending: true }))).toEqual({ action: 'queue' })
    expect(gate(input({ deliveryPending: true, queueEnabled: false }))).toEqual({
      action: 'block',
      reason: 'busy'
    })
  })
})

describe('while busy', () => {
  const busy = (overrides: Partial<GateInput> = {}): GateInput =>
    input({ state: 'busy', ...overrides })

  it('queues', () => {
    expect(gate(busy())).toEqual({ action: 'queue' })
  })

  it('queues over typed text too: queued text is sent only once the prompt is clean', () => {
    expect(gate(busy({ promptDirty: true }))).toEqual({ action: 'queue' })
  })

  it('takes the last place in the queue', () => {
    expect(gate(busy({ queueLength: MAX_QUEUE - 1 }))).toEqual({ action: 'queue' })
  })

  it('blocks when the queue is full', () => {
    expect(gate(busy({ queueLength: MAX_QUEUE }))).toEqual({ action: 'block', reason: 'queueFull' })
  })

  it('blocks when queueing is off', () => {
    expect(gate(busy({ queueEnabled: false }))).toEqual({ action: 'block', reason: 'busy' })
  })
})

describe('the messages', () => {
  it('differ for each reason', () => {
    const messages = Object.values(BLOCK_MESSAGES)
    expect(new Set(messages).size).toBe(messages.length)
  })
})
