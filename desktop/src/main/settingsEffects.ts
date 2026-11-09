import { app } from 'electron'
import type { Settings } from '../shared/settings'
import { log, setLogLevel } from './log'
import type { SettingsStore } from './settings/settingsStore'

/** Windows passes this when it starts VoiceUp at sign-in, so the window stays in the tray. */
export const BACKGROUND_FLAG = '--background'

/** An unpackaged build would add electron.exe to the startup list, so only a packaged one does. */
export function applyStartWithWindows(on: boolean): void {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, args: [BACKGROUND_FLAG] })
}

export interface SettingsEffects {
  readonly setSounds: (on: boolean) => void
  readonly setNotifications: (on: boolean) => void
  readonly selectModel: (id: Settings['speech']['modelId']) => void
  readonly applySpeechSettings: () => void
}

/** A saved change takes effect at once, or from the next recording. */
export function applySettingsChanges(store: SettingsStore, effects: SettingsEffects): void {
  store.subscribe((next, previous) => {
    if (next.logLevel !== previous.logLevel) setLogLevel(next.logLevel)
    if (next.ui.sounds !== previous.ui.sounds) effects.setSounds(next.ui.sounds)
    if (next.ui.notifications !== previous.ui.notifications) {
      effects.setNotifications(next.ui.notifications)
    }
    if (next.ui.startWithWindows !== previous.ui.startWithWindows) {
      applyStartWithWindows(next.ui.startWithWindows)
      log.info(`Start with Windows: ${next.ui.startWithWindows ? 'on' : 'off'}`)
    }
    if (next.speech.modelId !== previous.speech.modelId) {
      effects.selectModel(next.speech.modelId)
    } else if (
      next.speech.endSilenceSec !== previous.speech.endSilenceSec ||
      next.speech.maxRecordingSec !== previous.speech.maxRecordingSec
    ) {
      effects.applySpeechSettings()
    }
  })
  // Brings an entry from before S7.1 up to date, with the flag that keeps the window hidden.
  if (store.current.ui.startWithWindows) applyStartWithWindows(true)
}
