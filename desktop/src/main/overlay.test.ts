import type { BrowserWindow as RealBrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, resetFakes } from '../../test/fakes/electron'
import fakeLog from '../../test/fakes/electronLog'
import { Channels } from '../shared/ipcChannels'
import { Overlay } from './overlay'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

let window: BrowserWindow
let clock: number

function create(sounds = true): Overlay {
  return new Overlay({
    window: window as unknown as RealBrowserWindow,
    sounds,
    now: () => clock
  })
}

const states = (): unknown[] =>
  window.webContents.sent.filter(([c]) => c === Channels.overlayShow).map(([, s]) => s)
const sounds = (): unknown[] =>
  window.webContents.sent.filter(([c]) => c === Channels.overlaySound).map(([, s]) => s)

beforeEach(() => {
  resetFakes()
  window = new BrowserWindow({})
  clock = 1000
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the window', () => {
  it('lets clicks through and stays on top, even over fullscreen apps', () => {
    create()
    expect(window.ignoresMouse).toBe(true)
    expect(window.alwaysOnTop).toEqual([true, 'screen-saver'])
  })

  it('never takes focus when it appears', () => {
    const overlay = create()
    overlay.level(0.1)
    expect(window.shownInactive).toBe(1)
    expect(window.shown).toBe(false)
    expect(window.focused).toBe(false)
  })

  it('appears above the taskbar', () => {
    create().level(0.1)
    expect(window.bounds).toEqual({ x: 800, y: 960, width: 320, height: 64 })
  })

  it('does not reposition or re-show on every level', () => {
    const overlay = create()
    overlay.level(0.1)
    window.visible = true
    overlay.level(0.2)
    expect(window.shownInactive).toBe(1)
  })

  it('does nothing to a window that has closed', () => {
    const overlay = create()
    window.destroyed = true
    overlay.level(0.1)
    overlay.recordingStarted()
    expect(window.webContents.sent).toEqual([])
  })
})

describe('the phases', () => {
  it('says nothing until real audio arrives', () => {
    create().recordingStarted()
    expect(states()).toEqual([{ phase: 'hidden' }])
    expect(window.shownInactive).toBe(0)
  })

  it('shows Listening with the level', () => {
    create().level(0.25)
    expect(states()).toEqual([{ phase: 'listening', level: 0.25 }])
  })

  it('shows Transcribing when speech ends', () => {
    create().speechEnded()
    expect(states()).toEqual([{ phase: 'transcribing' }])
  })

  it('hides when finished', () => {
    const overlay = create()
    overlay.level(0.1)
    overlay.finished()
    expect(states().at(-1)).toEqual({ phase: 'hidden' })
    expect(window.hideCount).toBe(1)
  })

  it('shows an error with a next step, then hides by itself', () => {
    vi.useFakeTimers()
    const overlay = create()
    overlay.failed('NO_SPEECH')
    expect(states()[0]).toMatchObject({ phase: 'error', code: 'NO_SPEECH' })
    expect(JSON.stringify(states()[0])).toContain('press the hotkey again')
    vi.advanceTimersByTime(3999)
    expect(window.hideCount).toBe(0)
    vi.advanceTimersByTime(1)
    expect(states().at(-1)).toEqual({ phase: 'hidden' })
  })

  it('does not let an old error hide a new recording', () => {
    vi.useFakeTimers()
    const overlay = create()
    overlay.failed('NO_SPEECH')
    overlay.level(0.1)
    vi.advanceTimersByTime(5000)
    expect(states().at(-1)).toEqual({ phase: 'listening', level: 0.1 })
  })
})

describe('the sounds', () => {
  it('plays start on the press and stop when speech ends', () => {
    const overlay = create()
    overlay.recordingStarted()
    overlay.speechEnded()
    expect(sounds()).toEqual(['start', 'stop'])
  })

  it('plays stop on a cancel', () => {
    const overlay = create()
    overlay.recordingStarted()
    overlay.cancelled()
    expect(sounds()).toEqual(['start', 'stop'])
  })

  it('plays nothing when turned off', () => {
    const overlay = create(false)
    overlay.recordingStarted()
    overlay.speechEnded()
    overlay.cancelled()
    expect(sounds()).toEqual([])
  })
})

describe('the latency log', () => {
  it('times the hotkey to the first real audio, once', () => {
    const overlay = create()
    overlay.recordingStarted()
    clock += 120
    overlay.level(0.1)
    overlay.level(0.2)
    const timings = fakeLog.messages('info').filter(([m]) => String(m).includes('Listening'))
    expect(timings).toEqual([['Listening 120 ms after the hotkey']])
  })
})
