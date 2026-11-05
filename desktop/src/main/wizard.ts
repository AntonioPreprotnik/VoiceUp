import type { BrowserWindow } from 'electron'
import type { ClaudeCommand } from '../core/claudeCommand'
import { ClaudeStep } from '../core/claudeStep'
import { MESSAGES } from '../core/messages'
import { SignInStep } from '../core/signInStep'
import type { ClaudeState } from '../core/state/reducer'
import { WizardFlow } from '../core/wizardFlow'
import type { HookMessage } from '../shared/hooks'
import { Channels, type FolderStepStatus, type WizardView } from '../shared/ipcChannels'
import type { Settings } from '../shared/settings'
import { registerWizardIpc } from './ipc/wizard'
import { log } from './log'
import type { RunningInstall } from './pty/installClaude'
import { createWindow } from './windows/factory'

export interface WizardOptions {
  /** The app's own settings object, changed in place so later saves keep the progress. */
  readonly settings: Settings
  readonly save: (settings: Settings) => void
  readonly onFinished: () => void
  /** The user closed the window before finishing. */
  readonly onAbandoned: () => void
  readonly findClaude: () => Promise<ClaudeCommand | null>
  readonly readClaudeVersion: (command: ClaudeCommand) => Promise<string | null>
  readonly runInstaller: (onOutput: (text: string) => void) => RunningInstall
  /** The Windows folder picker. Null if the user cancels. */
  readonly chooseFolder: (window: BrowserWindow, current: string | null) => Promise<string | null>
  readonly isFolder: (path: string) => boolean
  /** Starts Claude in the terminal beside this window. Called once, on reaching Sign in. */
  readonly startClaude: (window: BrowserWindow) => void
  readonly restartClaude: () => void
  /** Sends text to Claude through the send gate. */
  readonly deliver: (text: string) => void
  readonly discardDelivery: () => void
  readonly promptDirty: () => boolean
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly apiKeySet: boolean
}

export interface Wizard {
  readonly window: BrowserWindow
  onClaudeState(state: ClaudeState): void
  onHook(message: HookMessage): void
}

/** Opens the first-run wizard, with its progress saved after each step. The caller loads the page. */
export function openWizard({
  settings,
  save,
  onFinished,
  onAbandoned,
  findClaude,
  readClaudeVersion,
  runInstaller,
  chooseFolder,
  isFolder,
  startClaude,
  restartClaude,
  deliver,
  discardDelivery,
  promptDirty,
  schedule,
  apiKeySet
}: WizardOptions): Wizard {
  const flow = new WizardFlow(settings.wizard.completed)
  const window = createWindow('wizard')
  // The app menu acts on a session and the speech model, which wait until the wizard is finished.
  // The caller must also not reinstall it while this is open: Electron would put it back here.
  window.removeMenu()

  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  let installing: RunningInstall | undefined
  const claudeStep = new ClaudeStep({
    find: findClaude,
    readVersion: readClaudeVersion,
    install: async () => {
      installing = runInstaller((text) => {
        send(Channels.wizardOutput, text)
      })
      await installing.done
      installing = undefined
    },
    onChange: () => {
      send(Channels.wizardChanged, view())
    },
    onError: (error) => {
      log.error('The Claude Code step failed', error)
    }
  })

  const signIn = new SignInStep({
    deliver,
    discard: discardDelivery,
    promptDirty,
    schedule,
    onChange: () => {
      send(Channels.wizardChanged, view())
    }
  })

  let claudeStarted = false
  const enteredStep = (): void => {
    if (claudeStarted || flow.currentStep !== 'signIn') return
    if (flow.completed.includes('signIn')) return
    claudeStarted = true
    startClaude(window)
  }

  const folder = (): FolderStepStatus => {
    const path = settings.claude.projectDir
    return { path, missing: path !== null && !isFolder(path) }
  }

  const canContinue = (): boolean => {
    if (flow.currentStep === 'claudeCode') return claudeStep.canContinue
    if (flow.currentStep === 'projectFolder') {
      const { path, missing } = folder()
      return path !== null && !missing
    }
    if (flow.currentStep === 'signIn') return signIn.isDone || flow.completed.includes('signIn')
    return true
  }
  const view = (): WizardView => ({
    ...flow.view,
    claude: claudeStep.status,
    folder: folder(),
    signIn: signIn.status,
    apiKeyWarning: apiKeySet ? MESSAGES.API_KEY_SET : null,
    canContinue: canContinue()
  })

  const persist = (): void => {
    settings.wizard = { done: flow.finished, completed: [...flow.completed] }
    try {
      save(settings)
    } catch (error: unknown) {
      log.error('Could not save the setup progress; it applies to this run only', error)
    }
  }

  let choosing = false
  const chooseProjectFolder = async (): Promise<void> => {
    if (choosing) return
    choosing = true
    try {
      const chosen = await chooseFolder(window, settings.claude.projectDir)
      if (chosen === null) return
      settings.claude = { ...settings.claude, projectDir: chosen }
      persist()
      // Claude runs in one folder for its whole session, so going back to change it restarts it.
      if (claudeStarted) restartClaude()
      send(Channels.wizardChanged, view())
    } catch (error: unknown) {
      log.error('Could not ask for a project folder', error)
    } finally {
      choosing = false
    }
  }

  registerWizardIpc({
    view,
    back: () => {
      flow.back()
      enteredStep()
      return view()
    },
    next: () => {
      // Main decides, so a page that enabled its own button still can't skip the check.
      if (flow.finished || !canContinue()) return view()
      const finishedNow = flow.next()
      persist()
      if (finishedNow) {
        log.info('Setup finished')
        onFinished()
        window.close()
      } else {
        enteredStep()
      }
      return view()
    },
    checkClaude: () => {
      void claudeStep.check()
      return view()
    },
    installClaude: () => {
      void claudeStep.install()
      return view()
    },
    chooseFolder: () => {
      void chooseProjectFolder()
      return view()
    },
    testClaude: () => {
      signIn.test()
      return view()
    },
    restartClaude: () => {
      if (claudeStarted) restartClaude()
      return view()
    }
  })

  window.once('closed', () => {
    installing?.stop()
    if (!flow.finished) onAbandoned()
  })
  void claudeStep.check()
  enteredStep()
  return {
    window,
    onClaudeState: (state) => {
      signIn.onClaudeState(state)
    },
    onHook: (message) => {
      signIn.onHook(message)
    }
  }
}
