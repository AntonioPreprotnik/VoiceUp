import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, resetFakes } from '../../../test/fakes/electron'
import fakeLog from '../../../test/fakes/electronLog'
import { MAX_TERM_INPUT_CHARS } from '../../shared/ipc'
import { Channels } from '../../shared/ipcChannels'
import type { PtyHost } from '../pty/host'
import { createWindow } from '../windows/factory'
import { registerTerminalIpc } from './terminal'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const APP_PAGE = 'app://voiceup/terminal/index.html'

const host = {
  write: vi.fn(),
  resize: vi.fn(),
  acknowledge: vi.fn(),
  restart: vi.fn(() => Promise.resolve())
}

function terminalEvent(frameUrl = APP_PAGE): unknown {
  createWindow('terminal')
  const window = BrowserWindow.instances.at(-1)
  if (window === undefined) throw new Error('No window was created')
  return { sender: { id: window.webContents.id }, senderFrame: { url: frameUrl } }
}

beforeEach(() => {
  resetFakes()
  vi.clearAllMocks()
  registerTerminalIpc(host as unknown as PtyHost)
})

describe('terminal IPC', () => {
  it('passes valid input to the PTY', () => {
    ipcMain.emit(Channels.termInput, terminalEvent(), 'ls\r')
    expect(host.write).toHaveBeenCalledWith('ls\r')
  })

  it('passes a valid resize', () => {
    ipcMain.emit(Channels.termResize, terminalEvent(), { cols: 80, rows: 24 })
    expect(host.resize).toHaveBeenCalledWith({ cols: 80, rows: 24 })
  })

  it('passes a valid ack', () => {
    ipcMain.emit(Channels.termAck, terminalEvent(), 500)
    expect(host.acknowledge).toHaveBeenCalledWith(500)
  })

  it('restarts the session on request', () => {
    ipcMain.emit(Channels.sessionRestart, terminalEvent(), {})
    expect(host.restart).toHaveBeenCalledOnce()
  })

  it('drops a restart from a frame on another origin', () => {
    ipcMain.emit(Channels.sessionRestart, terminalEvent('https://example.com/'), {})
    expect(host.restart).not.toHaveBeenCalled()
  })

  it('drops a restart with an unexpected payload', () => {
    ipcMain.emit(Channels.sessionRestart, terminalEvent(), { folder: 'C:\\Windows' })
    expect(host.restart).not.toHaveBeenCalled()
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })

  it('logs a restart that fails', async () => {
    host.restart.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    ipcMain.emit(Channels.sessionRestart, terminalEvent(), {})
    await vi.waitFor(() => {
      expect(fakeLog.messages('error')).toHaveLength(1)
    })
  })

  it.each([Channels.termInput, Channels.termResize, Channels.termAck])(
    'drops %s from a frame on another origin',
    (channel) => {
      ipcMain.emit(channel, terminalEvent('https://example.com/'), 'x')
      expect(host.write).not.toHaveBeenCalled()
      expect(host.resize).not.toHaveBeenCalled()
      expect(host.acknowledge).not.toHaveBeenCalled()
      expect(fakeLog.messages('warn')).toHaveLength(1)
    }
  )

  it('drops input from a webContents no factory created', () => {
    const event = { sender: { id: 999_999 }, senderFrame: { url: APP_PAGE } }
    ipcMain.emit(Channels.termInput, event, 'rm -rf\r')
    expect(host.write).not.toHaveBeenCalled()
  })

  it.each([
    [Channels.termInput, 'x'.repeat(MAX_TERM_INPUT_CHARS + 1)],
    [Channels.termInput, 5],
    [Channels.termResize, { cols: 'wide' }],
    [Channels.termAck, -1]
  ])('drops an invalid payload on %s', (channel, payload) => {
    ipcMain.emit(channel, terminalEvent(), payload)
    expect(host.write).not.toHaveBeenCalled()
    expect(host.resize).not.toHaveBeenCalled()
    expect(host.acknowledge).not.toHaveBeenCalled()
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })

  it('never logs the content of rejected input', () => {
    ipcMain.emit(Channels.termInput, terminalEvent(), 'y'.repeat(MAX_TERM_INPUT_CHARS + 1))
    expect(JSON.stringify(fakeLog.messages('warn'))).not.toContain('yyyy')
  })
})
