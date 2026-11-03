import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, resetFakes } from '../../../test/fakes/electron'
import fakeLog from '../../../test/fakes/electronLog'
import { RecordingToggle } from '../../core/recordingToggle'
import { Channels } from '../../shared/ipcChannels'
import type { WorkerCommand } from '../../shared/worker'
import { createWindow } from '../windows/factory'
import { RecordingController } from './recording'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

let toWorker: WorkerCommand[]
let toRecorder: [string, unknown][]
let destroyed: boolean
let controller: RecordingController
let next: number

function recorderEvent(frameUrl = 'app://voiceup/recorder/index.html'): unknown {
  createWindow('recorder', { showWhenReady: false })
  const window = BrowserWindow.instances.at(-1)
  if (window === undefined) throw new Error('No window was created')
  return { sender: { id: window.webContents.id }, senderFrame: { url: frameUrl } }
}

beforeEach(() => {
  resetFakes()
  toWorker = []
  toRecorder = []
  destroyed = false
  next = 1
  const recorder = {
    isDestroyed: () => destroyed,
    send: (channel: string, payload: unknown) => {
      toRecorder.push([channel, payload])
    }
  } as unknown as WebContents
  controller = new RecordingController({
    toggle: new RecordingToggle(() => `r${String(next++)}`),
    sendToWorker: (command) => toWorker.push(command),
    recorder,
    deviceId: null
  })
})

describe('the hotkey', () => {
  it('tells the worker first, then opens the mic', () => {
    controller.press()
    expect(toWorker).toEqual([{ type: 'start', recordingId: 'r1' }])
    expect(toRecorder).toEqual([[Channels.recorderStart, { recordingId: 'r1', deviceId: null }]])
  })

  it('cancels and closes the mic on the next press', () => {
    controller.press()
    controller.press()
    expect(toWorker.at(-1)).toEqual({ type: 'cancel', recordingId: 'r1' })
    expect(toRecorder.at(-1)).toEqual([Channels.recorderStop, { recordingId: 'r1' }])
  })

  it('does not send to a recorder that is gone', () => {
    destroyed = true
    controller.press()
    expect(toRecorder).toEqual([])
  })
})

describe('worker events', () => {
  it('closes the mic when speech ends', () => {
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 900 })
    expect(toRecorder.at(-1)).toEqual([Channels.recorderStop, { recordingId: 'r1' }])
  })

  it('closes the mic on an error, such as no speech', () => {
    controller.press()
    controller.onWorkerEvent({
      type: 'error',
      recordingId: 'r1',
      code: 'NO_SPEECH',
      message: 'No speech detected'
    })
    expect(toRecorder.at(-1)).toEqual([Channels.recorderStop, { recordingId: 'r1' }])
  })

  it('keeps the mic open while speech is going on', () => {
    controller.press()
    const before = toRecorder.length
    controller.onWorkerEvent({ type: 'speechStart', recordingId: 'r1' })
    controller.onWorkerEvent({ type: 'level', recordingId: 'r1', rms: 0.2 })
    expect(toRecorder).toHaveLength(before)
  })

  it('ignores events from a cancelled recording', () => {
    controller.press()
    controller.press()
    controller.press()
    const before = toRecorder.length
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 900 })
    expect(toRecorder).toHaveLength(before)
  })

  it('ignores events with no recording, such as ready', () => {
    controller.press()
    const before = toRecorder.length
    controller.onWorkerEvent({ type: 'ready', modelId: null, loadMs: 1 })
    expect(toRecorder).toHaveLength(before)
  })
})

describe('recorder errors', () => {
  it('ends the recording and tells the worker', () => {
    controller.press()
    ipcMain.emit(Channels.recorderError, recorderEvent(), { recordingId: 'r1', code: 'MIC_DENIED' })
    expect(toWorker.at(-1)).toEqual({ type: 'cancel', recordingId: 'r1' })
    expect(JSON.stringify(fakeLog.messages('warn'))).toContain('MIC_DENIED')
    controller.press()
    expect(toWorker.at(-1)).toEqual({ type: 'start', recordingId: 'r2' })
  })

  it('ignores an error from a recording already over', () => {
    controller.press()
    controller.press()
    const before = toWorker.length
    ipcMain.emit(Channels.recorderError, recorderEvent(), { recordingId: 'r1', code: 'MIC_DENIED' })
    expect(toWorker).toHaveLength(before)
  })

  it('drops an error from a frame on another origin', () => {
    controller.press()
    const before = toWorker.length
    ipcMain.emit(Channels.recorderError, recorderEvent('https://example.com/'), {
      recordingId: 'r1',
      code: 'MIC_DENIED'
    })
    expect(toWorker).toHaveLength(before)
  })

  it('drops a bad payload', () => {
    controller.press()
    const before = toWorker.length
    ipcMain.emit(Channels.recorderError, recorderEvent(), { recordingId: 'r1', code: 'NONSENSE' })
    expect(toWorker).toHaveLength(before)
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })
})
