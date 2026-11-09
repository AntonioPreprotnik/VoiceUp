import { MESSAGES, type MessageCode } from '../core/messages'
import { formatSize } from '../core/modelChoice'
import type { MicStepStatus, ModelStepStatus } from '../shared/ipcChannels'
import { log } from './log'
import type { ModelStatus } from './models/controller'

/** The speech model, as the wizard sees it. */
export interface WizardModels {
  /** Starts the download if the model isn't on disk. */
  ensure(): void
  status(): ModelStatus
  chosenModel(): { label: string; bytes: number; installed: boolean }
}

export interface VoiceStepsOptions {
  readonly models: WizardModels
  /** Turns the global hotkey on, once. False if another app has it. */
  readonly startHotkey: () => boolean
  /** As Electron names it, such as Control+Shift+Space. */
  readonly hotkey: string
}

/** The wizard's Speech model and Microphone and hotkey steps (S6.5). */
export class VoiceSteps {
  private hotkeyOn: boolean | null = null
  private heard: string | null = null
  private problem: MicStepStatus['problem'] = null
  private skipped = false

  constructor(private readonly options: VoiceStepsOptions) {}

  get modelReady(): boolean {
    return this.options.models.chosenModel().installed
  }

  get micDone(): boolean {
    return this.heard !== null || this.skipped
  }

  get model(): ModelStepStatus {
    const chosen = this.options.models.chosenModel()
    const status = this.options.models.status()
    const phase: ModelStepStatus['phase'] = chosen.installed
      ? 'ready'
      : status.phase === 'installing'
        ? status.stage
        : status.phase === 'failed'
          ? 'failed'
          : 'waiting'
    return {
      label: chosen.label,
      size: formatSize(chosen.bytes),
      phase,
      percent: status.phase === 'installing' ? status.percent : 0
    }
  }

  get mic(): MicStepStatus {
    return {
      hotkey: this.options.hotkey.replaceAll('Control', 'Ctrl'),
      hotkeyOn: this.hotkeyOn,
      heard: this.heard,
      problem: this.problem,
      skipped: this.skipped
    }
  }

  /** Starts or resumes the download. */
  ensureModel(): void {
    this.options.models.ensure()
  }

  /** The hotkey turns on the first time the step shows. */
  enteredMicStep(): void {
    this.hotkeyOn ??= this.options.startHotkey()
  }

  skipMicTest(): void {
    log.info('Setup: microphone test skipped')
    this.skipped = true
  }

  /** What the microphone test heard. Shown on the page, never sent and never logged. */
  onTranscript(text: string): void {
    this.heard = text
    this.problem = null
  }

  onVoiceFailed(code: MessageCode): void {
    this.problem = { title: MESSAGES[code].title, detail: MESSAGES[code].detail }
  }
}
