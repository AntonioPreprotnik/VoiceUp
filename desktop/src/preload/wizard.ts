import { contextBridge, ipcRenderer } from 'electron'
import type { Channels as SharedChannels, WizardApi, WizardResult } from '../shared/ipcChannels'

// A sandboxed preload must be a single file, so it can't share code with another preload: the
// bundler would split it into a chunk this can't load. These are checked against the shared list.
const Channels = {
  wizardGet: 'wizard:get',
  wizardNext: 'wizard:next',
  wizardBack: 'wizard:back'
} as const satisfies Partial<typeof SharedChannels>

// Wizard window preload. Security rule 7: named functions only, and the IPC event never reaches the
// page. Security rule 2: this preload serves the wizard window only.
const api: WizardApi = {
  view: () => ipcRenderer.invoke(Channels.wizardGet, {}) as Promise<WizardResult>,
  next: () => ipcRenderer.invoke(Channels.wizardNext, {}) as Promise<WizardResult>,
  back: () => ipcRenderer.invoke(Channels.wizardBack, {}) as Promise<WizardResult>
}

contextBridge.exposeInMainWorld('voiceupWizard', api)
