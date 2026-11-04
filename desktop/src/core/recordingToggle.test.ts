import { beforeEach, describe, expect, it } from 'vitest'
import { RecordingToggle, transcribeTimeoutMs } from './recordingToggle'

let next: number
let toggle: RecordingToggle

beforeEach(() => {
  next = 1
  toggle = new RecordingToggle(() => `r${String(next++)}`)
})

describe('transcribeTimeoutMs', () => {
  it.each([
    [0, 10000],
    [2400, 10000],
    [20000, 10000],
    [20002, 10001],
    [60000, 30000]
  ])('gives a %d ms clip %d ms', (clipMs, timeout) => {
    expect(transcribeTimeoutMs(clipMs)).toBe(timeout)
  })
})

describe('abandoning', () => {
  it('ends a recording, and says which', () => {
    toggle.press()
    expect(toggle.abandon()).toBe('r1')
    expect(toggle.phase).toBe('idle')
    expect(toggle.press()).toEqual({ type: 'start', recordingId: 'r2' })
  })

  it('has nothing to end when idle', () => {
    expect(toggle.abandon()).toBeUndefined()
  })

  it('drops late events from what it ended', () => {
    toggle.press()
    toggle.abandon()
    expect(toggle.onWorkerEvent({ type: 'transcript', recordingId: 'r1' })).toBe(false)
  })
})

describe('pressing the hotkey', () => {
  it('starts idle', () => {
    expect(toggle.phase).toBe('idle')
  })

  it('starts a recording with a new id', () => {
    expect(toggle.press()).toEqual({ type: 'start', recordingId: 'r1' })
    expect(toggle.phase).toBe('recording')
  })

  it('cancels while recording', () => {
    toggle.press()
    expect(toggle.press()).toEqual({ type: 'cancel', recordingId: 'r1' })
    expect(toggle.phase).toBe('idle')
  })

  it('cancels while transcribing', () => {
    toggle.press()
    toggle.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1' })
    expect(toggle.phase).toBe('transcribing')
    expect(toggle.press()).toEqual({ type: 'cancel', recordingId: 'r1' })
    expect(toggle.phase).toBe('idle')
  })

  it('uses a new id for the next recording', () => {
    toggle.press()
    toggle.press()
    expect(toggle.press()).toEqual({ type: 'start', recordingId: 'r2' })
  })
})

describe('worker events', () => {
  it.each([
    ['transcript', 'idle'],
    ['error', 'idle'],
    ['speechEnd', 'transcribing'],
    ['speechStart', 'recording'],
    ['level', 'recording']
  ])('%s leaves the phase at %s', (type, phase) => {
    toggle.press()
    expect(toggle.onWorkerEvent({ type, recordingId: 'r1' })).toBe(true)
    expect(toggle.phase).toBe(phase)
  })

  it('allows a new recording after a transcript', () => {
    toggle.press()
    toggle.onWorkerEvent({ type: 'transcript', recordingId: 'r1' })
    expect(toggle.press()).toEqual({ type: 'start', recordingId: 'r2' })
  })

  it('drops a late result from a cancelled recording', () => {
    toggle.press()
    toggle.press()
    toggle.press()
    expect(toggle.onWorkerEvent({ type: 'transcript', recordingId: 'r1' })).toBe(false)
    expect(toggle.phase).toBe('recording')
  })

  it('drops an event when nothing is recording', () => {
    expect(toggle.onWorkerEvent({ type: 'transcript', recordingId: 'r1' })).toBe(false)
  })

  it('drops an event with no recording id, such as ready', () => {
    toggle.press()
    expect(toggle.onWorkerEvent({ type: 'ready' })).toBe(false)
    expect(toggle.phase).toBe('recording')
  })
})
