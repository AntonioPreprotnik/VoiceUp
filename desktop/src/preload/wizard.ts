import { contextBridge, ipcRenderer } from 'electron'
import type {
  Channels as SharedChannels,
  WizardApi,
  WizardResult,
  WizardView
} from '../shared/ipcChannels'

// A sandboxed preload must be a single file, so it can't share code with another preload: the
// bundler would split it into a chunk this can't load. These are checked against the shared list.
const Channels = {
  wizardGet: 'wizard:get',
  wizardNext: 'wizard:next',
  wizardBack: 'wizard:back',
  wizardClaudeCheck: 'wizard:claudeCheck',
  wizardClaudeInstall: 'wizard:claudeInstall',
  wizardChooseFolder: 'wizard:chooseFolder',
  wizardTestClaude: 'wizard:testClaude',
  wizardRestartClaude: 'wizard:restartClaude',
  wizardChanged: 'wizard:changed',
  wizardOutput: 'wizard:output'
} as const satisfies Partial<typeof SharedChannels>

// Wizard window preload. Security rule 7: named functions only, and the IPC event never reaches the
// page. Security rule 2: this preload serves the wizard window only.
const api: WizardApi = {
  view: () => ipcRenderer.invoke(Channels.wizardGet, {}) as Promise<WizardResult>,
  next: () => ipcRenderer.invoke(Channels.wizardNext, {}) as Promise<WizardResult>,
  back: () => ipcRenderer.invoke(Channels.wizardBack, {}) as Promise<WizardResult>,
  checkClaude: () => ipcRenderer.invoke(Channels.wizardClaudeCheck, {}) as Promise<WizardResult>,
  installClaude: () =>
    ipcRenderer.invoke(Channels.wizardClaudeInstall, {}) as Promise<WizardResult>,
  chooseFolder: () => ipcRenderer.invoke(Channels.wizardChooseFolder, {}) as Promise<WizardResult>,
  testClaude: () => ipcRenderer.invoke(Channels.wizardTestClaude, {}) as Promise<WizardResult>,
  restartClaude: () =>
    ipcRenderer.invoke(Channels.wizardRestartClaude, {}) as Promise<WizardResult>,
  onChanged: (listener) => {
    const handler = (_event: unknown, view: WizardView): void => {
      listener(view)
    }
    ipcRenderer.on(Channels.wizardChanged, handler)
    return () => {
      ipcRenderer.off(Channels.wizardChanged, handler)
    }
  },
  onOutput: (listener) => {
    const handler = (_event: unknown, text: string): void => {
      listener(text)
    }
    ipcRenderer.on(Channels.wizardOutput, handler)
    return () => {
      ipcRenderer.off(Channels.wizardOutput, handler)
    }
  }
}

contextBridge.exposeInMainWorld('voiceupWizard', api)
