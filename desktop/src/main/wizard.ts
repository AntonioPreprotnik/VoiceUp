import type { BrowserWindow } from 'electron'
import { WizardFlow } from '../core/wizardFlow'
import type { Settings } from '../shared/settings'
import { registerWizardIpc } from './ipc/wizard'
import { log } from './log'
import { createWindow } from './windows/factory'

export interface WizardOptions {
  /** The app's own settings object, changed in place so later saves keep the progress. */
  readonly settings: Settings
  readonly save: (settings: Settings) => void
  readonly onFinished: () => void
  /** The user closed the window before finishing. */
  readonly onAbandoned: () => void
}

/** Opens the first-run wizard, with its progress saved after each step. The caller loads the page. */
export function openWizard({
  settings,
  save,
  onFinished,
  onAbandoned
}: WizardOptions): BrowserWindow {
  const flow = new WizardFlow(settings.wizard.completed)
  const window = createWindow('wizard')
  // The app menu acts on a session and the speech model, which wait until the wizard is finished.
  // The caller must also not reinstall it while this is open: Electron would put it back here.
  window.removeMenu()

  const persist = (): void => {
    settings.wizard = { done: flow.finished, completed: [...flow.completed] }
    try {
      save(settings)
    } catch (error: unknown) {
      log.error('Could not save the setup progress; it applies to this run only', error)
    }
  }

  registerWizardIpc({
    view: () => flow.view,
    back: () => {
      flow.back()
      return flow.view
    },
    next: () => {
      if (flow.finished) return flow.view
      const finishedNow = flow.next()
      persist()
      if (finishedNow) {
        log.info('Setup finished')
        onFinished()
        window.close()
      }
      return flow.view
    }
  })

  window.once('closed', () => {
    if (!flow.finished) onAbandoned()
  })
  return window
}
