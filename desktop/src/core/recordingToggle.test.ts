import { beforeEach, describe, expect, it } from 'vitest'
import { RecordingToggle } from './recordingToggle'

let next: number
let toggle: RecordingToggle

beforeEach(() => {
  next = 1
  toggle = new RecordingToggle(() => `r${String(next++)}`)
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
