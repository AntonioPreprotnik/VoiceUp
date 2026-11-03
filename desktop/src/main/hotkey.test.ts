import type { BrowserWindow as RealBrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, globalShortcut, resetFakes } from '../../test/fakes/electron'
import fakeLog from '../../test/fakes/electronLog'
import { registerHotkey, reportHotkeyTaken, unregisterHotkeys } from './hotkey'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

beforeEach(resetFakes)

describe('registerHotkey', () => {
  it('registers and reports success', () => {
    const onPress = vi.fn()
    expect(registerHotkey('Control+Shift+Space', onPress)).toBe(true)
    globalShortcut.press('Control+Shift+Space')
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('reports failure when another app owns it', () => {
    globalShortcut.takenByAnotherApp = 'Control+Shift+Space'
    expect(registerHotkey('Control+Shift+Space', () => undefined)).toBe(false)
  })

  it('reports failure, and logs, for an invalid combination', () => {
    globalShortcut.throwsOn = 'Nonsense+Key'
    expect(registerHotkey('Nonsense+Key', () => undefined)).toBe(false)
    expect(fakeLog.messages('error')).toHaveLength(1)
  })
})

describe('reportHotkeyTaken', () => {
  function report(): void {
    const window = new BrowserWindow({})
    reportHotkeyTaken(window as unknown as RealBrowserWindow, 'Control+Shift+Space')
  }

  it('tells the user, with the combination and what to do next', () => {
    report()
    const options = dialog.messageBoxes[0]
    expect(options?.['message']).toBe('Hotkey taken, pick another')
    expect(options?.['detail']).toContain('Control+Shift+Space')
    expect(options?.['detail']).toContain('settings.json')
  })

  it('logs the code', () => {
    report()
    expect(JSON.stringify(fakeLog.messages('warn'))).toContain('HOTKEY_TAKEN')
  })

  it('logs when the message cannot be shown', async () => {
    dialog.messageBoxFails = true
    report()
    await vi.waitFor(() => {
      expect(fakeLog.messages('error')).toHaveLength(1)
    })
  })
})

describe('unregisterHotkeys', () => {
  it('releases everything', () => {
    registerHotkey('Control+Shift+Space', () => undefined)
    unregisterHotkeys()
    expect(globalShortcut.registered.size).toBe(0)
  })
})
