import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, resetFakes } from '../../../test/fakes/electron'
import { statusView } from '../../core/state/status'
import { Channels } from '../../shared/ipcChannels'
import { createWindow } from '../windows/factory'
import { registerStatusIpc } from './status'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const reArm = vi.fn()
const cancelQueued = vi.fn()
const view = statusView('unknown', null)

function eventFrom(kind: 'terminal' | 'recorder'): unknown {
  createWindow(kind, { showWhenReady: false })
  const window = BrowserWindow.instances.at(-1)
  if (window === undefined) throw new Error('No window was created')
  return {
    sender: { id: window.webContents.id },
    senderFrame: { url: `app://voiceup/${kind}/index.html` }
  }
}

beforeEach(() => {
  resetFakes()
  vi.clearAllMocks()
  registerStatusIpc(() => view, reArm, cancelQueued)
})

describe('queue:cancel', () => {
  it('cancels from the terminal window', () => {
    ipcMain.emit(Channels.queueCancel, eventFrom('terminal'), { id: '3' })
    expect(cancelQueued).toHaveBeenCalledWith('3')
  })

  it('ignores any other window', () => {
    ipcMain.emit(Channels.queueCancel, eventFrom('recorder'), { id: '3' })
    expect(cancelQueued).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ id: 3 }], [{ id: 'x'.repeat(33) }], [{ id: '3', extra: true }]])(
    'ignores a payload of the wrong shape: %j',
    (payload) => {
      ipcMain.emit(Channels.queueCancel, eventFrom('terminal'), payload)
      expect(cancelQueued).not.toHaveBeenCalled()
    }
  )
})

describe('state:rearm', () => {
  it('re-arms from the terminal window', () => {
    ipcMain.emit(Channels.stateReArm, eventFrom('terminal'), {})
    expect(reArm).toHaveBeenCalledOnce()
  })

  it('ignores any other window', () => {
    ipcMain.emit(Channels.stateReArm, eventFrom('recorder'), {})
    expect(reArm).not.toHaveBeenCalled()
  })

  it('ignores a payload of the wrong shape', () => {
    ipcMain.emit(Channels.stateReArm, eventFrom('terminal'), { force: true })
    expect(reArm).not.toHaveBeenCalled()
  })
})

describe('state:get', () => {
  const handler = (): ((event: unknown) => unknown) => {
    const found = ipcMain.handlers.get(Channels.stateGet)
    if (found === undefined) throw new Error('No handler')
    return found
  }

  it('answers the terminal window', () => {
    expect(handler()(eventFrom('terminal'))).toEqual(view)
  })

  it('gives any other window nothing', () => {
    expect(handler()(eventFrom('recorder'))).toBeNull()
  })
})
