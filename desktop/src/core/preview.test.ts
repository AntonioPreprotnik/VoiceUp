import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LATE_PRESS_GUARD_MS, PreviewWindow } from './preview'

const COUNTDOWN = { previewMs: 700, alwaysConfirm: false }
const CONFIRM = { previewMs: 1000, alwaysConfirm: true }

let preview: PreviewWindow
let onSend: Mock
let onCancel: Mock

beforeEach(() => {
  vi.useFakeTimers()
  onSend = vi.fn()
  onCancel = vi.fn()
  preview = new PreviewWindow({
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    now: () => Date.now(),
    onSend,
    onCancel
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the time to read it', () => {
  it.each([
    ['one word the 3.5 s minimum', 'continue', 3500],
    ['five words the 3.5 s minimum', 'list the files in here', 3500],
    ['six words 4.2 s', 'list the files in this folder', 4200],
    ['words with more than one space between them 4.9 s', 'a  b\nc d e f g', 4900]
  ])('gives %s', (_label, text, expected) => {
    expect(preview.start(text, COUNTDOWN)).toEqual({ kind: 'showing', countdownMs: expected })
    vi.advanceTimersByTime(expected - 1)
    expect(onSend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSend).toHaveBeenCalledWith(text)
  })

  it('uses the configured time for each word', () => {
    expect(
      preview.start('a b c d e f g h i j k l', { previewMs: 500, alwaysConfirm: false })
    ).toEqual({
      kind: 'showing',
      countdownMs: 6000
    })
  })

  it('keeps the minimum with a shorter time for each word', () => {
    expect(preview.start('run the tests', { previewMs: 500, alwaysConfirm: false })).toEqual({
      kind: 'showing',
      countdownMs: 3500
    })
  })
})

describe('the countdown', () => {
  it('sends when it runs out, and not before', () => {
    expect(preview.start('continue', COUNTDOWN)).toEqual({ kind: 'showing', countdownMs: 3500 })
    vi.advanceTimersByTime(3499)
    expect(onSend).not.toHaveBeenCalled()
    expect(preview.active).toBe(true)
    vi.advanceTimersByTime(1)
    expect(onSend).toHaveBeenCalledWith('continue')
    expect(preview.active).toBe(false)
  })

  it('sends at once at 0, with nothing to show', () => {
    expect(preview.start('continue', { previewMs: 0, alwaysConfirm: false })).toEqual({
      kind: 'sent'
    })
    expect(onSend).toHaveBeenCalledWith('continue')
    expect(preview.active).toBe(false)
  })

  it('uses the configured length', () => {
    preview.start('continue', { previewMs: 5000, alwaysConfirm: false })
    vi.advanceTimersByTime(4999)
    expect(onSend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSend).toHaveBeenCalledOnce()
  })
})

describe('Esc', () => {
  it('cancels, and nothing is sent afterwards', () => {
    preview.start('continue', COUNTDOWN)
    preview.cancel()
    expect(onCancel).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(5000)
    expect(onSend).not.toHaveBeenCalled()
    expect(preview.active).toBe(false)
  })

  it('works right away, during the guard', () => {
    preview.start('continue', COUNTDOWN)
    vi.advanceTimersByTime(1)
    preview.cancel()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does nothing with no preview showing', () => {
    preview.cancel()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('the hotkey', () => {
  it('sends at once, and only once', () => {
    preview.start('continue', COUNTDOWN)
    vi.advanceTimersByTime(LATE_PRESS_GUARD_MS)
    expect(preview.press()).toBe(true)
    expect(onSend).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(5000)
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('is ignored for the first 300 ms: a late cancel press must not send', () => {
    preview.start('continue', COUNTDOWN)
    vi.advanceTimersByTime(LATE_PRESS_GUARD_MS - 1)
    expect(preview.press()).toBe(false)
    expect(onSend).not.toHaveBeenCalled()
    expect(preview.active).toBe(true)
  })

  it('leaves the countdown running when ignored', () => {
    preview.start('continue', COUNTDOWN)
    preview.press()
    vi.advanceTimersByTime(5000)
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('does nothing with no preview showing', () => {
    expect(preview.press()).toBe(false)
  })
})

describe('always confirm', () => {
  it('waits as long as it takes, with no countdown', () => {
    expect(preview.start('continue', CONFIRM)).toEqual({ kind: 'showing', countdownMs: null })
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(onSend).not.toHaveBeenCalled()
    expect(preview.active).toBe(true)
  })

  it('still waits with the preview length at 0', () => {
    expect(preview.start('continue', { previewMs: 0, alwaysConfirm: true }).kind).toBe('showing')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends on the hotkey', () => {
    preview.start('continue', CONFIRM)
    vi.advanceTimersByTime(LATE_PRESS_GUARD_MS)
    preview.press()
    expect(onSend).toHaveBeenCalledWith('continue')
  })

  it('keeps the late press guard', () => {
    preview.start('continue', CONFIRM)
    preview.press()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('cancels on Esc', () => {
    preview.start('continue', CONFIRM)
    preview.cancel()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(preview.active).toBe(false)
  })
})

describe('a new preview', () => {
  it('replaces the old one, whose timer must not send', () => {
    preview.start('old', COUNTDOWN)
    vi.advanceTimersByTime(500)
    preview.start('new', COUNTDOWN)
    vi.advanceTimersByTime(3499)
    expect(onSend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSend.mock.calls).toEqual([['new']])
  })

  it('has its own guard', () => {
    preview.start('old', CONFIRM)
    vi.advanceTimersByTime(LATE_PRESS_GUARD_MS)
    preview.start('new', CONFIRM)
    expect(preview.press()).toBe(false)
  })
})
