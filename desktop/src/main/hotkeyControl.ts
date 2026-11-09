import type { BrowserWindow } from 'electron'
import { Listening } from '../core/listening'
import type { ShutdownSteps } from '../core/shutdown'
import { registerHotkey, reportHotkeyTaken, unregisterHotkey, unregisterHotkeys } from './hotkey'
import { log } from './log'
import type { SettingsStore } from './settings/settingsStore'

export interface HotkeyControlOptions {
  readonly store: SettingsStore
  readonly steps: ShutdownSteps
  /** Where a taken hotkey is reported. */
  readonly window: BrowserWindow
  readonly press: () => void
  readonly cancelRecording: () => void
}

/** The global hotkey: on once, changed from Settings, paused from the tray (S7.1). */
export class HotkeyControl {
  private readonly listening: Listening

  constructor(private readonly options: HotkeyControlOptions) {
    const { store, steps, press, cancelRecording } = options
    this.listening = new Listening({
      register: (accelerator) => {
        steps.shortcuts ??= unregisterHotkeys
        return registerHotkey(accelerator, press)
      },
      unregister: unregisterHotkey,
      hotkey: () => store.current.hotkey,
      cancelRecording
    })
  }

  get hotkeyOn(): boolean {
    return this.listening.hotkeyOn
  }

  get isPaused(): boolean {
    return this.listening.isPaused
  }

  /** Once only: the wizard's microphone test may have turned it on already. */
  start(): boolean {
    return this.listening.start()
  }

  /** Turns it on, or says the keys are taken. */
  startOrReport(): void {
    if (!this.start()) reportHotkeyTaken(this.options.window, this.options.store.current.hotkey)
  }

  change(next: string): boolean {
    if (this.listening.change(next)) {
      log.info('Hotkey changed')
      return true
    }
    log.warn('HOTKEY_TAKEN: the new hotkey could not be registered')
    return false
  }

  /** Resuming reports HOTKEY_TAKEN if another app took the keys meanwhile. */
  setPaused(paused: boolean): void {
    if (paused) {
      this.listening.pause()
      log.info('Listening paused')
    } else if (this.listening.resume()) {
      log.info('Listening resumed')
    } else {
      log.warn('HOTKEY_TAKEN: the hotkey could not be had back after a pause')
      reportHotkeyTaken(this.options.window, this.options.store.current.hotkey)
    }
  }
}
