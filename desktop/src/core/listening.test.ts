import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Listening } from './listening'

/** Keys some other app holds. */
let taken: Set<string>
/** Keys VoiceUp holds now. */
let held: Set<string>
let saved: string
const cancelRecording = vi.fn()

function listening(): Listening {
  return new Listening({
    register: (key) => {
      if (taken.has(key) || held.has(key)) return false
      held.add(key)
      return true
    },
    unregister: (key) => {
      held.delete(key)
    },
    hotkey: () => saved,
    cancelRecording
  })
}

beforeEach(() => {
  taken = new Set()
  held = new Set()
  saved = 'Control+Shift+Space'
  cancelRecording.mockReset()
})

describe('Listening', () => {
  it('starts once, and reports a key another app has', () => {
    const ears = listening()
    expect(ears.start()).toBe(true)
    expect(ears.start()).toBe(true)
    expect([...held]).toEqual(['Control+Shift+Space'])

    taken.add('Control+Shift+Space')
    held.clear()
    const other = listening()
    expect(other.start()).toBe(false)
    expect(other.hotkeyOn).toBe(false)
  })

  it('pauses: the keys go back to Windows and a recording stops', () => {
    const ears = listening()
    ears.start()
    ears.pause()
    expect(held.size).toBe(0)
    expect(ears.isPaused).toBe(true)
    expect(ears.hotkeyOn).toBe(false)
    expect(cancelRecording).toHaveBeenCalledOnce()
    ears.pause()
    expect(cancelRecording).toHaveBeenCalledOnce()
  })

  it('resumes, unless another app took the keys meanwhile', () => {
    const ears = listening()
    ears.start()
    ears.pause()
    expect(ears.resume()).toBe(true)
    expect(held.has('Control+Shift+Space')).toBe(true)

    ears.pause()
    taken.add('Control+Shift+Space')
    expect(ears.resume()).toBe(false)
    expect(ears.isPaused).toBe(false)
  })

  it('paused before it starts, it starts paused and listens on resume', () => {
    const ears = listening()
    ears.pause()
    expect(ears.start()).toBe(false)
    expect(held.size).toBe(0)
    expect(ears.resume()).toBe(true)
  })

  it('moves to a new key, keeping the old one if the new is taken', () => {
    const ears = listening()
    ears.start()
    expect(ears.change('Alt+V')).toBe(true)
    expect([...held]).toEqual(['Alt+V'])
    saved = 'Alt+V'

    taken.add('Alt+X')
    expect(ears.change('Alt+X')).toBe(false)
    expect([...held]).toEqual(['Alt+V'])
    expect(ears.hotkeyOn).toBe(true)
  })

  it('while paused, only tries a new key and stays paused', () => {
    const ears = listening()
    ears.start()
    ears.pause()
    expect(ears.change('Alt+V')).toBe(true)
    expect(held.size).toBe(0)
    taken.add('Alt+X')
    expect(ears.change('Alt+X')).toBe(false)
    saved = 'Alt+V'
    expect(ears.resume()).toBe(true)
    expect([...held]).toEqual(['Alt+V'])
  })
})
