// One hotkey press is one recording, tagged with an id so a late result from a cancelled recording
// is dropped (TECH_SPEC §5). Pressing again while recording or transcribing cancels.

export type RecordingPhase = 'idle' | 'recording' | 'transcribing'

export type RecordingCommand =
  | { readonly type: 'start'; readonly recordingId: string }
  | { readonly type: 'cancel'; readonly recordingId: string }

/** The worker events that move a recording along. Anything else leaves the phase alone. */
export interface RecordingEvent {
  readonly type: string
  readonly recordingId?: string | undefined
}

const MIN_TRANSCRIBE_TIMEOUT_MS = 10000

/** Half the clip, so a flat limit can't kill a long but healthy decode (TECH_SPEC §5.3). */
export function transcribeTimeoutMs(clipMs: number): number {
  return Math.max(MIN_TRANSCRIBE_TIMEOUT_MS, clipMs / 2)
}

export class RecordingToggle {
  private current: string | undefined
  private phaseNow: RecordingPhase = 'idle'

  constructor(private readonly createId: () => string) {}

  get phase(): RecordingPhase {
    return this.phaseNow
  }

  press(): RecordingCommand {
    if (this.current !== undefined) {
      const recordingId = this.current
      this.current = undefined
      this.phaseNow = 'idle'
      return { type: 'cancel', recordingId }
    }
    const recordingId = this.createId()
    this.current = recordingId
    this.phaseNow = 'recording'
    return { type: 'start', recordingId }
  }

  /** Ends the recording from outside, when the worker can't. Returns which one, if any. */
  abandon(): string | undefined {
    const recordingId = this.current
    this.current = undefined
    this.phaseNow = 'idle'
    return recordingId
  }

  /** Returns whether the event belongs to the current recording. Others must be dropped. */
  onWorkerEvent(event: RecordingEvent): boolean {
    if (event.recordingId === undefined || event.recordingId !== this.current) return false
    if (event.type === 'speechEnd') {
      this.phaseNow = 'transcribing'
    } else if (event.type === 'transcript' || event.type === 'error') {
      this.current = undefined
      this.phaseNow = 'idle'
    }
    return true
  }
}
