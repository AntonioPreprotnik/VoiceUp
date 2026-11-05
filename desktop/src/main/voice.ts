import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, net, type BrowserWindow } from 'electron'
import type { Delivery } from '../core/delivery/delivery'
import { MESSAGES, type MessageCode } from '../core/messages'
import { RecordingToggle } from '../core/recordingToggle'
import type { ShutdownSteps } from '../core/shutdown'
import type { Settings } from '../shared/settings'
import { escapeKey } from './hotkey'
import { log } from './log'
import { loadManifest, ModelController, modelTitle } from './models/controller'
import { ModelManager } from './models/manager'
import type { Overlay } from './overlay'
import { RecordingController, type RecordingOptions } from './speech/recording'
import { SpeechSupervisor } from './speech/supervisor'
import { workerInit } from './speech/workerInit'
import { loadRenderer } from './windows/factory'

export interface VoiceOptions {
  readonly settings: Settings
  readonly overlay: Overlay
  readonly recorderWindow: BrowserWindow
  readonly delivery: Delivery
  readonly voiceBlock: () => MessageCode | null
  readonly micDeviceId: () => string | null
  /** The window that shows a model's progress, if one is still open. */
  readonly progressWindow: () => BrowserWindow | undefined
  readonly rebuildMenu: () => void
  readonly steps: ShutdownSteps
  /** See RecordingOptions.divert. */
  readonly divert: () => ((text: string) => void) | null
  /** Something went wrong with voice, as the overlay also shows. */
  readonly onVoiceFailed: (code: MessageCode) => void
  readonly onModelStatus: () => void
}

export interface Voice {
  readonly recording: RecordingController
  readonly models: ModelController
}

/** From the microphone to text: the recorder window, the speech worker and its models. */
export function createVoice({
  settings,
  overlay,
  recorderWindow,
  delivery,
  voiceBlock,
  micDeviceId,
  progressWindow,
  rebuildMenu,
  steps,
  divert,
  onVoiceFailed,
  onModelStatus
}: VoiceOptions): Voice {
  // The overlay, which also tells the wizard's microphone test what went wrong.
  const watched: RecordingOptions['overlay'] = {
    recordingStarted: () => {
      overlay.recordingStarted()
    },
    level: (rms) => {
      overlay.level(rms)
    },
    speechEnded: () => {
      overlay.speechEnded()
    },
    preview: (text, countdownMs) => {
      overlay.preview(text, countdownMs)
    },
    finished: () => {
      overlay.finished()
    },
    cancelled: () => {
      overlay.cancelled()
    },
    failed: (code) => {
      overlay.failed(code)
      onVoiceFailed(code)
    }
  }
  const recording = new RecordingController({
    toggle: new RecordingToggle(randomUUID),
    sendToWorker: (command) => {
      speech.send(command)
    },
    workerRunning: () => speech.running,
    restartWorker: () => {
      speech.restart()
    },
    recorder: recorderWindow.webContents,
    getDeviceId: micDeviceId,
    minWords: settings.speech.minWords,
    voiceBlock,
    previewSettings: () => settings.delivery,
    delivery: {
      get holding() {
        return delivery.holding
      },
      deliver: (text) => {
        delivery.deliver(text)
      },
      retry: () => {
        delivery.retry()
      }
    },
    overlay: watched,
    escape: escapeKey,
    divert
  })
  const speech = new SpeechSupervisor({
    onEvent: (event) => {
      if (event.type === 'ready') log.info(`Speech worker ready in ${String(event.loadMs)} ms`)
      if (event.type === 'error') log.warn(`Speech worker error: ${event.code}: ${event.message}`)
      recording.onWorkerEvent(event)
    },
    onCrash: () => {
      recording.workerLost()
    },
    onGaveUp: () => {
      log.error(MESSAGES.WORKER_CRASHED.title)
      overlay.failed('WORKER_CRASHED')
    }
  })
  let shownPhase = 'idle'
  const models = new ModelController({
    manifest: loadManifest(),
    manager: new ModelManager({
      root: join(app.getPath('userData'), 'models'),
      fetch: (url, init) => net.fetch(url, init)
    }),
    modelId: settings.speech.modelId,
    onStatus: (status) => {
      onModelStatus()
      const window = progressWindow()
      if (window === undefined) return
      window.setTitle(modelTitle(status))
      window.setProgressBar(status.phase === 'installing' ? status.percent / 100 : -1)
      // The menu has no percentage, so it changes only with the phase.
      if (status.phase !== shownPhase) {
        shownPhase = status.phase
        rebuildMenu()
      }
    },
    onReady: (model) => {
      // Whatever is being recorded can't be finished by a worker about to go.
      recording.cancel()
      speech.restart(workerInit(settings.speech, model))
      rebuildMenu()
      onModelStatus()
    },
    onFailed: (code) => {
      overlay.failed(code)
      onModelStatus()
    }
  })
  speech.start(workerInit(settings.speech, models.installedModel()))
  steps.worker ??= () => speech.stop()

  // After the load: a port sent earlier arrives before the preload listens, and is lost.
  recorderWindow.webContents.once('did-finish-load', () => {
    speech.connectRecorder(recorderWindow.webContents)
  })
  // The hidden window has nowhere else to report a problem. It never logs audio or text.
  recorderWindow.webContents.on('console-message', ({ level, message }) => {
    if (level === 'warning' || level === 'error') log.warn(`Recorder: ${message}`)
  })
  loadRenderer(recorderWindow, 'recorder').catch((error: unknown) => {
    log.error('Could not load the recorder window', error)
  })
  return { recording, models }
}
