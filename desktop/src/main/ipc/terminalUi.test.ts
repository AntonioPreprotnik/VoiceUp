import type { BrowserWindow as RealBrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  resetFakes,
  shell
} from '../../../test/fakes/electron'
import fakeLog from '../../../test/fakes/electronLog'
import { Channels } from '../../shared/ipcChannels'
import { createWindow } from '../windows/factory'
import { registerTerminalUiIpc } from './terminalUi'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const APP_PAGE = 'app://voiceup/terminal/index.html'
const OTHER_PAGE = 'https://example.com/'

let window: BrowserWindow

function eventFrom(frameUrl = APP_PAGE): unknown {
  return { sender: { id: window.webContents.id }, senderFrame: { url: frameUrl } }
}

function invoke(channel: string, event: unknown): unknown {
  const handler = ipcMain.handlers.get(channel)
  if (handler === undefined) throw new Error(`No handler on ${channel}`)
  return handler(event)
}

beforeEach(() => {
  resetFakes()
  createWindow('terminal')
  const created = BrowserWindow.instances.at(-1)
  if (created === undefined) throw new Error('No window was created')
  window = created
  registerTerminalUiIpc(window as unknown as RealBrowserWindow, () => 18)
})

describe('the clipboard', () => {
  it('writes text from the terminal window', () => {
    ipcMain.emit(Channels.clipboardWrite, eventFrom(), 'copied')
    expect(clipboard.text).toBe('copied')
  })

  it('reads text for the terminal window', async () => {
    clipboard.text = 'pasted'
    await expect(invoke(Channels.clipboardRead, eventFrom())).resolves.toBe('pasted')
  })

  it('will not write for a frame on another origin', () => {
    clipboard.text = 'before'
    ipcMain.emit(Channels.clipboardWrite, eventFrom(OTHER_PAGE), 'overwritten')
    expect(clipboard.text).toBe('before')
  })

  it('will not read for a frame on another origin', () => {
    clipboard.text = 'a password'
    expect(invoke(Channels.clipboardRead, eventFrom(OTHER_PAGE))).toBe('')
  })

  it('drops a payload that is not text', () => {
    clipboard.text = 'before'
    ipcMain.emit(Channels.clipboardWrite, eventFrom(), 5)
    expect(clipboard.text).toBe('before')
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })
})

describe('links', () => {
  it('opens an https: link in the browser', () => {
    ipcMain.emit(Channels.linkOpen, eventFrom(), { url: 'https://example.com/docs' })
    expect(shell.external).toEqual(['https://example.com/docs'])
  })

  it.each(['http://example.com', 'file:///C:/Windows/calc.exe', 'ms-settings:privacy'])(
    'blocks %s and does not log the address',
    (url) => {
      ipcMain.emit(Channels.linkOpen, eventFrom(), { url })
      expect(shell.external).toEqual([])
      expect(fakeLog.messages('warn')).toHaveLength(1)
      expect(JSON.stringify(fakeLog.messages('warn'))).not.toContain(url)
    }
  )

  it('drops a link from a frame on another origin', () => {
    ipcMain.emit(Channels.linkOpen, eventFrom(OTHER_PAGE), { url: 'https://example.com' })
    expect(shell.external).toEqual([])
  })

  it('logs a link the system could not open', async () => {
    shell.openFails = true
    ipcMain.emit(Channels.linkOpen, eventFrom(), { url: 'https://example.com' })
    await vi.waitFor(() => {
      expect(fakeLog.messages('error')).toHaveLength(1)
    })
  })
})

describe('the right-click menu', () => {
  interface Item {
    label: string
    enabled?: boolean
    click: () => void
  }
  const items = (): Item[] => Menu.popups.at(-1)?.template as Item[]
  const item = (label: string): Item | undefined => items().find((i) => i.label === label)

  it('pops up over the window', () => {
    ipcMain.emit(Channels.termContextMenu, eventFrom(), { hasSelection: true })
    expect(Menu.popups).toHaveLength(1)
    expect(Menu.popups[0]?.options).toEqual({ window })
  })

  it('enables Copy only with a selection', () => {
    ipcMain.emit(Channels.termContextMenu, eventFrom(), { hasSelection: false })
    expect(item('Copy')?.enabled).toBe(false)
    ipcMain.emit(Channels.termContextMenu, eventFrom(), { hasSelection: true })
    expect(item('Copy')?.enabled).toBe(true)
  })

  it.each([
    ['Copy', 'copy'],
    ['Paste', 'paste']
  ])('%s asks the window to do it', (label, action) => {
    ipcMain.emit(Channels.termContextMenu, eventFrom(), { hasSelection: true })
    item(label)?.click()
    expect(window.webContents.sent).toContainEqual([Channels.termMenuAction, action])
  })

  it('does not send to a window that has closed', () => {
    ipcMain.emit(Channels.termContextMenu, eventFrom(), { hasSelection: true })
    window.destroyed = true
    item('Paste')?.click()
    expect(window.webContents.sent).toEqual([])
  })

  it('drops a request from a frame on another origin', () => {
    ipcMain.emit(Channels.termContextMenu, eventFrom(OTHER_PAGE), { hasSelection: true })
    expect(Menu.popups).toEqual([])
  })
})

describe('the font size', () => {
  it('reports the saved size', () => {
    expect(invoke(Channels.settingsFontSize, eventFrom())).toBe(18)
  })

  it('reports nothing to a frame on another origin', () => {
    expect(invoke(Channels.settingsFontSize, eventFrom(OTHER_PAGE))).toBeNull()
  })
})
