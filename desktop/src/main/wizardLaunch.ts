import { screen, type BrowserWindow } from 'electron'
import { sideBySide } from '../core/sideBySide'
import type { ClaudeLink } from './claudeLink'
import type { HotkeyControl } from './hotkeyControl'
import { log } from './log'
import type { ClaudeSession } from './pty/session'
import type { SettingsStore } from './settings/settingsStore'
import type { createVoice } from './voice'
import { openWizard, type Wizard } from './wizard'
import { wizardSystem } from './wizardSystem'

export interface WizardLaunchOptions {
  readonly settings: SettingsStore
  readonly terminalWindow: BrowserWindow
  readonly claude: ClaudeSession
  readonly link: Pick<ClaudeLink, 'claudeState' | 'delivery'>
  readonly models: ReturnType<typeof createVoice>['models']
  readonly hotkeys: HotkeyControl
  /** Loads the terminal page, which is what starts Claude. */
  readonly loadTerminal: () => Promise<void>
  readonly onFinished: () => void
  readonly onAbandoned: () => void
  readonly onStartFailed: (error: unknown) => void
}

/** Opens the first-run wizard, joined to the running app. The caller loads its page. */
export function launchWizard({
  settings,
  terminalWindow,
  claude,
  link: { claudeState, delivery },
  models,
  hotkeys,
  loadTerminal,
  onFinished,
  onAbandoned,
  onStartFailed
}: WizardLaunchOptions): Wizard {
  const wizard = openWizard({
    ...wizardSystem(),
    settings,
    onFinished,
    onAbandoned,
    // Claude starts beside the wizard, so the user sees both.
    startClaude: (window) => {
      const { terminal, wizard: beside } = sideBySide(
        screen.getDisplayMatching(window.getBounds()).workArea
      )
      terminalWindow.setBounds(terminal)
      window.setBounds(beside)
      loadTerminal().catch(onStartFailed)
    },
    restartClaude: () => {
      claude.host.restart().catch((error: unknown) => {
        log.error('Could not restart Claude', error)
      })
    },
    deliver: (text) => {
      delivery.deliver(text)
    },
    discardDelivery: () => {
      delivery.discard()
    },
    promptDirty: () => claudeState.promptDirty,
    models: {
      ensure: () => {
        models.ensure()
      },
      status: () => models.status,
      chosenModel: () => models.chosenModel()
    },
    startHotkey: () => hotkeys.start(),
    hotkey: settings.current.hotkey,
    launchedWithChrome: () => claude.launchedWithChrome
  })
  wizard.onClaudeState(claudeState.state)
  return wizard
}
