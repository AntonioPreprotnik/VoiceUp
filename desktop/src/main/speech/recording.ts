import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import type { RecordingToggle } from '../../core/recordingToggle'
import { RecorderError } from '../../shared/ipc'
import { Channels } from '../../shared/ipcChannels'
import type { WorkerCommand, WorkerEvent } from '../../shared/worker'
import { SENDERS } from '../ipc/allowlist'
import { validateSender } from '../ipc/validateSender'
import { log } from '../log'

export interface RecordingOptions {
  readonly toggle: RecordingToggle
  readonly sendToWorker: (command: WorkerCommand) => void
  readonly recorder: WebContents
  readonly deviceId: string | null
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
    const { toggle, sendToWorker, deviceId } = this.options
    const command = toggle.press()
    log.info(`Hotkey: ${command.type} recording`)
    sendToWorker(command)
    if (command.type === 'start') {
      // The worker first, so it has a VAD ready when the first frame arrives.
      this.toRecorder(Channels.recorderStart, { recordingId: command.recordingId, deviceId })
    } else {
      this.stopMic(command.recordingId)
    }
  }

  /** The mic closes as soon as the speech ends, not when the transcript arrives. */
  onWorkerEvent(event: WorkerEvent): void {
    const recordingId = 'recordingId' in event ? event.recordingId : undefined
    if (!this.options.toggle.onWorkerEvent(event) || recordingId === undefined) return
    if (event.type === 'speechStart') log.info('Speech started')
    if (event.type === 'speechEnd') log.info(`Speech ended after ${String(event.durationMs)} ms`)
    if (event.type === 'speechEnd' || event.type === 'error') this.stopMic(recordingId)
  }

  private onRecorderError(recordingId: string, code: string): void {
    log.warn(`Recorder error: ${code}`)
    const { toggle, sendToWorker } = this.options
    // It's still current only if nothing else ended it, in which case it needs ending now.
    if (toggle.onWorkerEvent({ type: 'error', recordingId })) {
      sendToWorker({ type: 'cancel', recordingId })
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
