import type { BrowserWindow } from 'electron'
import type { ClaudeCommand } from '../core/claudeCommand'
import { ClaudeStep } from '../core/claudeStep'
import { WizardFlow } from '../core/wizardFlow'
import { Channels, type WizardView } from '../shared/ipcChannels'
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
}

/** Opens the first-run wizard, with its progress saved after each step. The caller loads the page. */
export function openWizard({
  settings,
  save,
  onFinished,
  onAbandoned,
  findClaude,
  readClaudeVersion,
  runInstaller
}: WizardOptions): BrowserWindow {
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

  const canContinue = (): boolean => flow.currentStep !== 'claudeCode' || claudeStep.canContinue
  const view = (): WizardView => ({
    ...flow.view,
    claude: claudeStep.status,
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

  registerWizardIpc({
    view,
    back: () => {
      flow.back()
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
    }
  })

  window.once('closed', () => {
    installing?.stop()
    if (!flow.finished) onAbandoned()
  })
  void claudeStep.check()
  return window
}
