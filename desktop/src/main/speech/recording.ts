import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import type { MessageCode } from '../../core/messages'
import { PreviewWindow, type PreviewSettings } from '../../core/preview'
import { transcribeTimeoutMs, type RecordingToggle } from '../../core/recordingToggle'
import { clean } from '../../core/text/clean'
import { RecorderError } from '../../shared/ipc'
import { Channels } from '../../shared/ipcChannels'
import type { WorkerCommand, WorkerEvent } from '../../shared/worker'
import { SENDERS } from '../ipc/allowlist'
import { validateSender } from '../ipc/validateSender'
import { log } from '../log'
import { logTranscript } from '../logConfig'
import type { Overlay } from '../overlay'

export interface RecordingOptions {
  readonly toggle: RecordingToggle
  readonly sendToWorker: (command: WorkerCommand) => void
  /** False once the worker has crashed too often to come back. */
  readonly workerRunning: () => boolean
  /** Replaces a worker stuck on a decode. */
  readonly restartWorker: () => void
  readonly recorder: WebContents
  /** Read at each recording, so a new choice applies from the next one. */
  readonly getDeviceId: () => string | null
  /** A transcript with fewer words than this is dropped. */
  readonly minWords: number
  /** Why voice is off right now, or null. */
  readonly voiceBlock: () => MessageCode | null
  readonly previewSettings: () => PreviewSettings
  /** Takes the text once the user lets it through, and holds one that was blocked. */
  readonly delivery: {
    readonly holding: boolean
    deliver(text: string): void
    retry(): void
  }
  /** Esc, held only while there is something to cancel (TECH_SPEC §4.4). */
  readonly escape: { hold(onPress: () => void): void; release(): void }
  readonly overlay: Pick<
    Overlay,
    'recordingStarted' | 'level' | 'speechEnded' | 'preview' | 'finished' | 'cancelled' | 'failed'
  >
}

/** Ties the hotkey, the recorder window and the worker together for one recording at a time. */
export class RecordingController {
  private transcribeTimer: ReturnType<typeof setTimeout> | undefined
  private clipMs = 0
  private readonly preview: PreviewWindow

  constructor(private readonly options: RecordingOptions) {
    this.preview = new PreviewWindow({
      schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms)
        return () => {
          clearTimeout(timer)
        }
      },
      now: () => Date.now(),
      onSend: (text) => {
        options.overlay.finished()
        options.escape.release()
        options.delivery.deliver(text)
      },
      onCancel: () => {
        log.info('Preview cancelled')
        options.overlay.cancelled()
        options.escape.release()
      }
    })
    ipcMain.on(Channels.recorderError, (event: IpcMainEvent, raw: unknown) => {
      if (!validateSender(event, ...SENDERS[Channels.recorderError])) return
      const parsed = RecorderError.safeParse(raw)
      if (!parsed.success) {
        log.warn(`Dropped an invalid IPC payload on ${Channels.recorderError}`)
        return
      }
      this.onRecorderError(parsed.data.recordingId, parsed.data.code)
    })
  }

  press(): void {
    const { toggle, sendToWorker, getDeviceId, overlay, escape, workerRunning } = this.options
    // Never a new recording while one waits to be sent. A press in the guard does nothing at all.
    if (this.preview.active) {
      if (this.preview.press()) log.info('Hotkey: send now')
      return
    }
    // Never a new recording while one waits for a retry.
    if (this.options.delivery.holding) {
      log.info('Hotkey: retry')
      this.options.delivery.retry()
      return
    }
    // Starting now would open the mic for a recording nothing can ever end.
    if (toggle.phase === 'idle' && !workerRunning()) {
      log.warn('Hotkey: no speech worker to record with')
      overlay.failed('WORKER_CRASHED')
      return
    }
    const block = toggle.phase === 'idle' ? this.options.voiceBlock() : null
    if (block !== null) {
      log.warn(`Hotkey: voice is off, ${block}`)
      overlay.failed(block)
      return
    }
    const command = toggle.press()
    log.info(`Hotkey: ${command.type} recording`)
    sendToWorker(command)
    if (command.type === 'start') {
      // The worker first, so it has a VAD ready when the first frame arrives.
      this.toRecorder(Channels.recorderStart, {
        recordingId: command.recordingId,
        deviceId: getDeviceId()
      })
      overlay.recordingStarted()
      escape.hold(() => {
        this.cancel()
      })
    } else {
      this.clearTimer()
      this.stopMic(command.recordingId)
      overlay.cancelled()
      escape.release()
    }
  }

  /** Esc, or the worker restarting: like pressing the hotkey again, but only ever cancels. */
  cancel(): void {
    if (this.preview.active) this.preview.cancel()
    else if (this.options.toggle.phase !== 'idle') this.press()
  }

  /** The worker died, so nothing it was doing will ever report back. */
  workerLost(): void {
    this.abandon('WORKER_ERROR')
  }

  /** The mic closes as soon as the speech ends, not when the transcript arrives. */
  onWorkerEvent(event: WorkerEvent): void {
    // A failure the worker can't tie to a recording, such as a frame it couldn't read, would leave
    // the current one waiting for audio that never gets through.
    if (event.type === 'error' && event.recordingId === undefined) {
      this.abandon(event.code)
      return
    }
    const recordingId = 'recordingId' in event ? event.recordingId : undefined
    if (!this.options.toggle.onWorkerEvent(event) || recordingId === undefined) return
    const { overlay } = this.options
    if (event.type === 'level') overlay.level(event.rms)
    if (event.type === 'speechStart') log.info('Speech started')
    if (event.type === 'speechEnd') {
      log.info(`Speech ended after ${String(event.durationMs)} ms`)
      overlay.speechEnded()
      this.startTimer(event.durationMs)
    }
    if (event.type === 'transcript') {
      this.clearTimer()
      log.debug(`Transcribed ${String(this.clipMs)} ms of speech in ${String(event.decodeMs)} ms`)
      logTranscript(log, event.text)
      this.showPreview(event.text)
    }
    if (event.type === 'error') {
      this.clearTimer()
      overlay.failed(event.code)
      this.options.escape.release()
    }
    if (event.type === 'speechEnd' || event.type === 'error') this.stopMic(recordingId)
  }

  /** Esc stays held through a preview, since it is what cancels one. */
  private showPreview(raw: string): void {
    const { overlay, escape, minWords, previewSettings } = this.options
    const text = clean(raw, minWords)
    if (text === null) {
      log.info('TRANSCRIPT_DROPPED: nothing usable in the transcript')
      overlay.failed('TRANSCRIPT_DROPPED')
      escape.release()
      return
    }
    const started = this.preview.start(text, previewSettings())
    if (started.kind === 'showing') overlay.preview(text, started.countdownMs)
  }

  /** Kills the worker if it never answers, since a stuck decode can't be cancelled (§5.3). */
  private startTimer(clipMs: number): void {
    this.clipMs = clipMs
    this.clearTimer()
    const timeoutMs = transcribeTimeoutMs(clipMs)
    this.transcribeTimer = setTimeout(() => {
      log.error(`TRANSCRIBE_TIMEOUT: no transcript after ${String(timeoutMs)} ms`)
      this.abandon('TRANSCRIBE_TIMEOUT')
      this.options.restartWorker()
    }, timeoutMs)
  }

  private clearTimer(): void {
    clearTimeout(this.transcribeTimer)
    this.transcribeTimer = undefined
  }

  /** Ends the current recording, if there is one, without the worker's help. */
  private abandon(code: MessageCode): void {
    const recordingId = this.options.toggle.abandon()
    if (recordingId === undefined) return
    this.clearTimer()
    this.stopMic(recordingId)
    this.options.overlay.failed(code)
    this.options.escape.release()
  }

  private onRecorderError(recordingId: string, code: MessageCode): void {
    log.warn(`Recorder error: ${code}`)
    const { toggle, sendToWorker } = this.options
    // It's still current only if nothing else ended it, in which case it needs ending now.
    if (toggle.onWorkerEvent({ type: 'error', recordingId })) {
      sendToWorker({ type: 'cancel', recordingId })
      this.options.overlay.failed(code)
      this.options.escape.release()
    }
  }

  private stopMic(recordingId: string): void {
    this.toRecorder(Channels.recorderStop, { recordingId })
  }

  private toRecorder(channel: string, payload: unknown): void {
    const { recorder } = this.options
    if (!recorder.isDestroyed()) recorder.send(channel, payload)
  }
}
