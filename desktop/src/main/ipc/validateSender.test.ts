import type { IpcMainEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, BrowserWindow, resetFakes } from '../../../test/fakes/electron'
import fakeLog from '../../../test/fakes/electronLog'
import { createWindow } from '../windows/factory'
import { validateSender } from './validateSender'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const DEV_URL = 'http://localhost:5173'
const APP_PAGE = 'app://voiceup/terminal/index.html'

function terminalId(): number {
  createWindow('terminal')
  const window = BrowserWindow.instances.at(-1)
  if (window === undefined) throw new Error('No window was created')
  return window.webContents.id
}

// The handler only reads these two fields of the event.
function eventFrom(id: number, frameUrl: string | undefined): IpcMainEvent {
  return {
    sender: { id },
    senderFrame: frameUrl === undefined ? null : { url: frameUrl }
  } as unknown as IpcMainEvent
}

beforeEach(() => {
  resetFakes()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('validateSender', () => {
  it('accepts an allowed window on app://', () => {
    expect(validateSender(eventFrom(terminalId(), APP_PAGE), 'terminal')).toBe(true)
    expect(fakeLog.messages('warn')).toEqual([])
  })

  it('rejects a window kind the channel does not allow', () => {
    expect(validateSender(eventFrom(terminalId(), APP_PAGE))).toBe(false)
  })

  it('rejects a webContents that no factory created', () => {
    expect(validateSender(eventFrom(999_999, APP_PAGE), 'terminal')).toBe(false)
  })

  it('rejects a destroyed frame', () => {
    expect(validateSender(eventFrom(terminalId(), undefined), 'terminal')).toBe(false)
  })

  it.each(['https://example.com/', 'file:///C:/index.html', 'about:blank'])(
    'rejects a frame on %s',
    (url) => {
      expect(validateSender(eventFrom(terminalId(), url), 'terminal')).toBe(false)
    }
  )

  it('logs every rejection', () => {
    validateSender(eventFrom(999_999, APP_PAGE), 'terminal')
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })

  it('rejects the dev server when packaged', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_URL)
    app.isPackaged = true
    const event = eventFrom(terminalId(), `${DEV_URL}/terminal/index.html`)
    expect(validateSender(event, 'terminal')).toBe(false)
  })

  it('accepts the dev server only when unpackaged', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_URL)
    app.isPackaged = false
    const event = eventFrom(terminalId(), `${DEV_URL}/terminal/index.html`)
    expect(validateSender(event, 'terminal')).toBe(true)
  })
})
