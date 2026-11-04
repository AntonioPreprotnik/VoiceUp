import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
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
let micDevice: string | null
let workerRunning: boolean
let voiceBlock: 'HOOKS_BLOCKED' | null
let restartWorker: Mock
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
  micDevice = null
  workerRunning = true
  voiceBlock = null
  restartWorker = vi.fn()
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
    workerRunning: () => workerRunning,
    restartWorker,
    recorder,
    getDeviceId: () => micDevice,
    minWords: 1,
    voiceBlock: () => voiceBlock,
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

  it('uses the microphone chosen at the time of each recording', () => {
    controller.press()
    controller.press()
    micDevice = 'usb-mic'
    controller.press()
    expect(toRecorder.at(-1)).toEqual([
      Channels.recorderStart,
      { recordingId: 'r2', deviceId: 'usb-mic' }
    ])
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

describe('a transcript', () => {
  it('goes to the log only at debug, with its timing', () => {
    const debug = vi.spyOn(fakeLog, 'debug')
    const others = [
      vi.spyOn(fakeLog, 'info'),
      vi.spyOn(fakeLog, 'warn'),
      vi.spyOn(fakeLog, 'error')
    ]
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 2400 })
    controller.onWorkerEvent({
      type: 'transcript',
      recordingId: 'r1',
      text: 'delete the database',
      decodeMs: 108
    })
    expect(debug).toHaveBeenCalledWith('Transcribed 2400 ms of speech in 108 ms')
    expect(debug).toHaveBeenCalledWith('Transcript: delete the database')
    for (const spy of others) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('delete the database')
    }
  })
})

describe('when voice is off', () => {
  it('says why, without opening the mic', () => {
    voiceBlock = 'HOOKS_BLOCKED'
    controller.press()
    expect(overlay.failed).toHaveBeenCalledWith('HOOKS_BLOCKED')
    expect(toRecorder).toEqual([])
    expect(toWorker).toEqual([])
  })

  it('still lets a recording already running be cancelled', () => {
    controller.press()
    voiceBlock = 'HOOKS_BLOCKED'
    controller.press()
    expect(toWorker.at(-1)).toEqual({ type: 'cancel', recordingId: 'r1' })
  })
})

describe('a transcript with nothing usable', () => {
  function finishWith(text: string): void {
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 11000 })
    controller.onWorkerEvent({ type: 'transcript', recordingId: 'r1', text, decodeMs: 161 })
  }

  it.each(['', '[BLANK_AUDIO]', '(music)', '...'])('tells the user, for "%s"', (text) => {
    finishWith(text)
    expect(overlay.failed).toHaveBeenCalledWith('TRANSCRIPT_DROPPED')
    expect(overlay.finished).not.toHaveBeenCalled()
  })

  it('finishes normally for usable text', () => {
    finishWith('continue')
    expect(overlay.finished).toHaveBeenCalledOnce()
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('lets the next recording start, and releases Esc', () => {
    finishWith('')
    expect(escape.held).toBeUndefined()
    controller.press()
    expect(toWorker.at(-1)).toEqual({ type: 'start', recordingId: 'r2' })
  })

  it('logs the drop at info without any of the text', () => {
    const info = vi.spyOn(fakeLog, 'info')
    finishWith('[secret words]')
    expect(info).toHaveBeenCalledWith('TRANSCRIPT_DROPPED: nothing usable in the transcript')
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret')
  })
})

describe('the transcribe timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function untilTranscribing(durationMs: number): void {
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs })
  }

  it('waits 10 s for a short clip, then restarts the worker and tells the user', () => {
    untilTranscribing(2400)
    vi.advanceTimersByTime(9999)
    expect(restartWorker).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(restartWorker).toHaveBeenCalledOnce()
    expect(overlay.failed).toHaveBeenCalledWith('TRANSCRIBE_TIMEOUT')
    expect(escape.held).toBeUndefined()
  })

  it('waits half the clip for a long one', () => {
    untilTranscribing(60000)
    vi.advanceTimersByTime(29999)
    expect(restartWorker).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(restartWorker).toHaveBeenCalledOnce()
  })

  it('leaves the next press free to start a new recording', () => {
    untilTranscribing(2400)
    vi.advanceTimersByTime(10000)
    controller.press()
    expect(toWorker.at(-1)).toEqual({ type: 'start', recordingId: 'r2' })
  })

  it('drops a transcript that arrives too late', () => {
    untilTranscribing(2400)
    vi.advanceTimersByTime(10000)
    controller.onWorkerEvent({ type: 'transcript', recordingId: 'r1', text: 'x', decodeMs: 1 })
    expect(overlay.finished).not.toHaveBeenCalled()
  })

  it.each([
    ['a transcript', { type: 'transcript', recordingId: 'r1', text: 'x', decodeMs: 1 }],
    ['an error', { type: 'error', recordingId: 'r1', code: 'WORKER_ERROR', message: 'bad' }]
  ] as const)('stops at %s', (_label, event) => {
    untilTranscribing(2400)
    controller.onWorkerEvent(event)
    vi.advanceTimersByTime(60000)
    expect(restartWorker).not.toHaveBeenCalled()
  })

  it('stops at a cancel', () => {
    untilTranscribing(2400)
    controller.press()
    vi.advanceTimersByTime(60000)
    expect(restartWorker).not.toHaveBeenCalled()
  })

  it('does not run while still recording', () => {
    controller.press()
    vi.advanceTimersByTime(60000)
    expect(restartWorker).not.toHaveBeenCalled()
    expect(overlay.failed).not.toHaveBeenCalled()
  })
})

describe('no hung states', () => {
  it('ends a recording when the worker dies, and closes the mic', () => {
    controller.press()
    controller.workerLost()
    expect(toRecorder.at(-1)).toEqual([Channels.recorderStop, { recordingId: 'r1' }])
    expect(overlay.failed).toHaveBeenCalledWith('WORKER_ERROR')
    expect(escape.held).toBeUndefined()
    controller.press()
    expect(toWorker.at(-1)).toEqual({ type: 'start', recordingId: 'r2' })
  })

  it('stays quiet when the worker dies with nothing recording', () => {
    controller.workerLost()
    expect(overlay.failed).not.toHaveBeenCalled()
  })

  it('stops the timeout when the worker dies, so it restarts only once', () => {
    vi.useFakeTimers()
    controller.press()
    controller.onWorkerEvent({ type: 'speechEnd', recordingId: 'r1', durationMs: 2400 })
    controller.workerLost()
    vi.advanceTimersByTime(60000)
    vi.useRealTimers()
    expect(restartWorker).not.toHaveBeenCalled()
  })

  it('ends a recording on a worker error with no recording id', () => {
    controller.press()
    controller.onWorkerEvent({ type: 'error', code: 'WORKER_ERROR', message: 'bad frame' })
    expect(overlay.failed).toHaveBeenCalledWith('WORKER_ERROR')
    expect(toRecorder.at(-1)).toEqual([Channels.recorderStop, { recordingId: 'r1' }])
  })

  it('does not open the mic when no worker is left', () => {
    workerRunning = false
    controller.press()
    expect(overlay.failed).toHaveBeenCalledWith('WORKER_CRASHED')
    expect(toRecorder).toEqual([])
    expect(toWorker).toEqual([])
  })

  it('can still cancel a recording after the worker is gone', () => {
    controller.press()
    workerRunning = false
    controller.press()
    expect(overlay.cancelled).toHaveBeenCalled()
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

  it('ends the recording when the microphone is unplugged', () => {
    controller.press()
    ipcMain.emit(Channels.recorderError, recorderEvent(), {
      recordingId: 'r1',
      code: 'MIC_MISSING'
    })
    expect(toWorker.at(-1)).toEqual({ type: 'cancel', recordingId: 'r1' })
    expect(overlay.failed).toHaveBeenCalledWith('MIC_MISSING')
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
