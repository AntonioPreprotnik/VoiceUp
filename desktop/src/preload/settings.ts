import { contextBridge, ipcRenderer } from 'electron'
import type {
  Channels as SharedChannels,
  SettingsApi,
  SettingsResult,
  SettingsView
} from '../shared/ipcChannels'

// A sandboxed preload must be a single file, so it can't share code with another preload: the
// bundler would split it into a chunk this can't load. These are checked against the shared list.
const Channels = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  settingsRetryModel: 'settings:retryModel',
  settingsChanged: 'settings:changed'
} as const satisfies Partial<typeof SharedChannels>

// Settings window preload. Security rule 7: named functions only, and the IPC event never reaches
// the page. Security rule 2: this preload serves the settings window only.
const api: SettingsApi = {
  get: () => ipcRenderer.invoke(Channels.settingsGet, {}) as Promise<SettingsResult>,
  set: (changes) => ipcRenderer.invoke(Channels.settingsSet, changes) as Promise<SettingsResult>,
  reset: () => ipcRenderer.invoke(Channels.settingsReset, {}) as Promise<SettingsResult>,
  retryModel: () => ipcRenderer.invoke(Channels.settingsRetryModel, {}) as Promise<SettingsResult>,
  onChanged: (listener) => {
    const handler = (_event: unknown, view: SettingsView): void => {
      listener(view)
    }
    ipcRenderer.on(Channels.settingsChanged, handler)
    return () => {
      ipcRenderer.off(Channels.settingsChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('voiceupSettings', api)
