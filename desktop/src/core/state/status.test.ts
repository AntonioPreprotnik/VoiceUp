import { describe, expect, it } from 'vitest'
import type { ClaudeState } from './reducer'
import { dotBitmap, noticeFor, statusView } from './status'

const STATES: readonly ClaudeState[] = [
  'starting',
  'idle',
  'busy',
  'awaitingPermission',
  'awaitingInput',
  'unknown',
  'exited'
]

describe('statusView', () => {
  it('gives every state its own color and its own text', () => {
    const views = STATES.map((state) => statusView(state, null))
    expect(new Set(views.map(({ color }) => color)).size).toBe(STATES.length)
    expect(new Set(views.map(({ label }) => label)).size).toBe(STATES.length)
    for (const { label, detail } of views) {
      expect(label).not.toBe('')
      expect(detail).not.toBe('')
    }
  })

  it('offers re-arm only while unknown', () => {
    for (const state of STATES) {
      expect(statusView(state, null).canReArm).toBe(state === 'unknown')
    }
  })

  it('says voice is off when the hooks are blocked, whatever the state', () => {
    for (const state of STATES) {
      const view = statusView(state, 'HOOKS_BLOCKED')
      expect(view.state).toBe('blocked')
      expect(view.label).toBe('Voice off')
      expect(view.detail).toContain('block')
      expect(view.canReArm).toBe(false)
    }
  })
})

describe('the queue', () => {
  const queue = [{ id: '1', preview: 'run the tests' }]

  it('is empty by default', () => {
    expect(statusView('busy', null).queue).toEqual([])
  })

  it('is carried through every state', () => {
    for (const state of STATES) expect(statusView(state, null, queue).queue).toEqual(queue)
  })

  it('is carried through when voice is off too', () => {
    expect(statusView('idle', 'HOOKS_BLOCKED', queue).queue).toEqual(queue)
  })
})

describe('noticeFor', () => {
  it.each<[ClaudeState, ClaudeState, string | null]>([
    ['busy', 'idle', 'Claude finished'],
    ['busy', 'awaitingPermission', 'Claude needs your permission'],
    ['idle', 'awaitingPermission', 'Claude needs your permission'],
    ['busy', 'awaitingInput', 'Claude has a question'],
    ['awaitingPermission', 'idle', null],
    ['unknown', 'idle', null],
    ['starting', 'idle', null],
    ['idle', 'busy', null],
    ['busy', 'unknown', null],
    ['busy', 'exited', null],
    ['awaitingPermission', 'awaitingPermission', null]
  ])('%s to %s', (previous, state, title) => {
    expect(noticeFor(previous, state)?.title ?? null).toBe(title)
  })
})

describe('dotBitmap', () => {
  const SIZE = 32
  const pixel = (pixels: Uint8Array, x: number, y: number): number[] => {
    const at = (y * SIZE + x) * 4
    return [...pixels.slice(at, at + 4)]
  }

  it('has four bytes for each pixel', () => {
    expect(dotBitmap('#4ec96f', SIZE)).toHaveLength(SIZE * SIZE * 4)
  })

  it('puts the color in the middle, in blue, green, red, alpha order', () => {
    expect(pixel(dotBitmap('#102030', SIZE), 16, 16)).toEqual([0x30, 0x20, 0x10, 255])
  })

  it('leaves the corners clear', () => {
    expect(pixel(dotBitmap('#ffffff', SIZE), 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('premultiplies the soft edge, so it has no bright fringe', () => {
    const pixels = dotBitmap('#ffffff', SIZE)
    for (let at = 0; at < pixels.length; at += 4) {
      expect(pixels[at]).toBeLessThanOrEqual(pixels[at + 3] ?? 0)
    }
  })
})
