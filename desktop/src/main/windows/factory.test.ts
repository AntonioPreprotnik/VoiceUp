import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, resetFakes } from '../../../test/fakes/electron'
import { createWindow, windowKindOf, windowOptions, WINDOW_KINDS } from './factory'

vi.mock('electron', () => import('../../../test/fakes/electron'))

function lastWindow(): BrowserWindow {
  const window = BrowserWindow.instances.at(-1)
  if (window === undefined) throw new Error('No window was created')
  return window
}

beforeEach(resetFakes)

describe.each(WINDOW_KINDS)('the %s window', (kind) => {
  it('is isolated and sandboxed, with no Node (rule 1)', () => {
    const preferences = windowOptions(kind).webPreferences
    expect(preferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    })
    expect(preferences?.nodeIntegrationInWorker).toBeUndefined()
    expect(preferences?.nodeIntegrationInSubFrames).toBeUndefined()
    expect(preferences?.experimentalFeatures).toBeUndefined()
    expect(preferences?.enableBlinkFeatures).toBeUndefined()
    expect(preferences?.allowRunningInsecureContent).toBeUndefined()
    expect(preferences?.webviewTag).toBeUndefined()
  })

  it('cannot have the security options overridden by its own settings', () => {
    expect(windowOptions(kind).webPreferences?.sandbox).toBe(true)
    expect(windowOptions(kind).webPreferences?.contextIsolation).toBe(true)
  })

  it('passes those options to BrowserWindow unchanged', () => {
    createWindow(kind)
    expect(lastWindow().options).toEqual(windowOptions(kind))
  })

  it('blocks navigation (rule 5)', () => {
    createWindow(kind)
    const preventDefault = vi.fn()
    lastWindow().webContents.emit('will-navigate', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('denies new windows (rule 5)', () => {
    createWindow(kind)
    expect(lastWindow().webContents.windowOpenHandler?.()).toEqual({ action: 'deny' })
  })

  it('stays hidden until ready, then shows', () => {
    createWindow(kind)
    const window = lastWindow()
    expect(window.options['show']).toBe(false)
    window.emit('ready-to-show')
    expect(window.shown).toBe(true)
  })

  it('can stay hidden for the smoke test', () => {
    createWindow(kind, { showWhenReady: false })
    const window = lastWindow()
    window.emit('ready-to-show')
    expect(window.shown).toBe(false)
  })

  it('is known by webContents id only while open', () => {
    createWindow(kind)
    const window = lastWindow()
    expect(windowKindOf(window.webContents.id)).toBe(kind)
    window.emit('closed')
    expect(windowKindOf(window.webContents.id)).toBeUndefined()
  })
})

describe('the recorder window', () => {
  it('keeps capturing while hidden', () => {
    expect(windowOptions('recorder').webPreferences?.backgroundThrottling).toBe(false)
  })
})

describe('window kinds', () => {
  it('each have their own preload (rule 2)', () => {
    const preloads = WINDOW_KINDS.map((kind) => windowOptions(kind).webPreferences?.preload)
    expect(new Set(preloads).size).toBe(WINDOW_KINDS.length)
    expect(preloads.every((preload) => preload !== undefined)).toBe(true)
  })
})
