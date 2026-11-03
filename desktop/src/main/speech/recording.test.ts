import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
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
let escape: { held: (() => void) | undefined; hold(onPress: () => void): void; release(): void }
let overlay: {
  recordingStarted: Mock
  level: Mock
  speechEnded: Mock
  finished: Mock
  cancelled: Mock
  failed: Mock
}

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
  escape = {
    held: undefined,
    hold(onPress) {
      this.held = onPress
    },
    release() {
      this.held = undefined
    }
  }
  overlay = {
    recordingStarted: vi.fn(),
    level: vi.fn(),
    speechEnded: vi.fn(),
    finished: vi.fn(),
    cancelled: vi.fn(),
    failed: vi.fn()
  }
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
    deviceId: null,
    overlay,
    escape
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

describe('Esc', () => {
  function pressEsc(): void {
    if (escape.held === undefined) throw new Error('Esc is not held')
    escape.held()
  }

  it('is free until a recording starts', () => {
    expect(escape.held).toBeUndefined()
  })

  it('is held while recording', () => {
    controller.press()
    expect(escape.held).toBeDefined()
  })

  it('discards the recording: the worker drops it and the mic closes', () => {
    controller.press()
    pressEsc()
    expect(toWorker.at(-1)).toEqual({ type: 'cancel', recordingId: 'r1' })
    expect(toRecorder.at(-1)).toEqual([Channels.recorderStop, { recordingId: 'r1' }])
    expect(overlay.cancelled).toHaveBeenCalledOnce()
  })

  it('discards while transcribing too, and a late transcript goes nowhere', () => {
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 900 })
    pressEsc()
    expect(toWorker.at(-1)).toEqual({ type: 'cancel', recordingId: 'r1' })
    controller.onWorkerEvent({ type: 'transcript', recordingId: 'r1', text: 'late', decodeMs: 1 })
    expect(overlay.finished).not.toHaveBeenCalled()
  })

  it('never starts a recording', () => {
    controller.press()
    const held = escape.held
    pressEsc()
    const before = toWorker.length
    held?.()
    expect(toWorker).toHaveLength(before)
  })

  it.each([
    [
      'a cancel by hotkey',
      () => {
        controller.press()
      }
    ],
    [
      'a transcript',
      () => {
        controller.onWorkerEvent({ type: 'transcript', recordingId: 'r1', text: 'hi', decodeMs: 1 })
      }
    ],
    [
      'a worker error',
      () => {
        controller.onWorkerEvent({
          type: 'error',
          recordingId: 'r1',
          code: 'NO_SPEECH',
          message: 'x'
        })
      }
    ],
    [
      'a mic error',
      () => {
        ipcMain.emit(Channels.recorderError, recorderEvent(), {
          recordingId: 'r1',
          code: 'MIC_DENIED'
        })
      }
    ]
  ])('is given back after %s, so other apps get it again', (_label, end) => {
    controller.press()
    end()
    expect(escape.held).toBeUndefined()
  })

  it('stays held until the transcript, since speech ending can still be cancelled', () => {
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 900 })
    expect(escape.held).toBeDefined()
  })

  it('stays held when an event from an old recording arrives', () => {
    controller.press()
    controller.press()
    controller.press()
    controller.onWorkerEvent({ type: 'transcript', recordingId: 'r1', text: 'old', decodeMs: 1 })
    expect(escape.held).toBeDefined()
  })
})

describe('the overlay', () => {
  it('follows a recording from start to finish', () => {
    controller.press()
    expect(overlay.recordingStarted).toHaveBeenCalledOnce()
    controller.onWorkerEvent({ type: 'level', recordingId: 'r1', rms: 0.3 })
    expect(overlay.level).toHaveBeenCalledWith(0.3)
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 900 })
    expect(overlay.speechEnded).toHaveBeenCalledOnce()
    controller.onWorkerEvent({ type: 'transcript', recordingId: 'r1', text: 'hi', decodeMs: 1 })
    expect(overlay.finished).toHaveBeenCalledOnce()
  })

  it('shows a cancel', () => {
    controller.press()
    controller.press()
    expect(overlay.cancelled).toHaveBeenCalledOnce()
  })

  it('shows a worker error by its code', () => {
    controller.press()
    controller.onWorkerEvent({
      type: 'error',
      recordingId: 'r1',
      code: 'MODEL_MISSING',
      message: 'No speech model is loaded'
    })
    expect(overlay.failed).toHaveBeenCalledWith('MODEL_MISSING')
  })

  it('shows a microphone error', () => {
    controller.press()
    ipcMain.emit(Channels.recorderError, recorderEvent(), { recordingId: 'r1', code: 'MIC_DENIED' })
    expect(overlay.failed).toHaveBeenCalledWith('MIC_DENIED')
  })

  it('ignores anything from a cancelled recording', () => {
    controller.press()
    controller.press()
    controller.press()
    controller.onWorkerEvent({ type: 'level', recordingId: 'r1', rms: 0.3 })
    expect(overlay.level).not.toHaveBeenCalled()
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
