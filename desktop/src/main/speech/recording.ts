import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import type { MessageCode } from '../../core/messages'
import type { RecordingToggle } from '../../core/recordingToggle'
import { RecorderError } from '../../shared/ipc'
import { Channels } from '../../shared/ipcChannels'
import type { WorkerCommand, WorkerEvent } from '../../shared/worker'
import { SENDERS } from '../ipc/allowlist'
import { validateSender } from '../ipc/validateSender'
import { log } from '../log'
import type { Overlay } from '../overlay'

export interface RecordingOptions {
  readonly toggle: RecordingToggle
  readonly sendToWorker: (command: WorkerCommand) => void
  readonly recorder: WebContents
  /** Read at each recording, so a new choice applies from the next one. */
  readonly getDeviceId: () => string | null
  /** Esc, held only while there is something to cancel (TECH_SPEC §4.4). */
  readonly escape: { hold(onPress: () => void): void; release(): void }
  readonly overlay: Pick<
    Overlay,
    'recordingStarted' | 'level' | 'speechEnded' | 'finished' | 'cancelled' | 'failed'
  >
}

/** Ties the hotkey, the recorder window and the worker together for one recording at a time. */
export class RecordingController {
  constructor(private readonly options: RecordingOptions) {
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
    const { toggle, sendToWorker, getDeviceId, overlay, escape } = this.options
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
      this.stopMic(command.recordingId)
      overlay.cancelled()
      escape.release()
    }
  }

  /** Esc: the same as pressing the hotkey again, but only ever cancels. */
  private cancel(): void {
    if (this.options.toggle.phase !== 'idle') this.press()
  }

  /** The mic closes as soon as the speech ends, not when the transcript arrives. */
  onWorkerEvent(event: WorkerEvent): void {
    const recordingId = 'recordingId' in event ? event.recordingId : undefined
    if (!this.options.toggle.onWorkerEvent(event) || recordingId === undefined) return
    const { overlay } = this.options
    if (event.type === 'level') overlay.level(event.rms)
    if (event.type === 'speechStart') log.info('Speech started')
    if (event.type === 'speechEnd') {
      log.info(`Speech ended after ${String(event.durationMs)} ms`)
      overlay.speechEnded()
    }
    if (event.type === 'transcript') overlay.finished()
    if (event.type === 'error') overlay.failed(event.code)
    if (event.type === 'transcript' || event.type === 'error') this.options.escape.release()
    if (event.type === 'speechEnd' || event.type === 'error') this.stopMic(recordingId)
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
