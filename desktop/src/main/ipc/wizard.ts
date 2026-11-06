import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { WizardAction, WizardChromeOpen } from '../../shared/ipc'
import {
  Channels,
  type ChromeBrowser,
  type WizardResult,
  type WizardView
} from '../../shared/ipcChannels'
import { log } from '../log'
import { SENDERS } from './allowlist'
import { validateSender } from './validateSender'

export interface WizardActions {
  view(): WizardView
  next(): WizardView
  back(): WizardView
  checkClaude(): WizardView
  installClaude(): WizardView
  chooseFolder(): WizardView
  testClaude(): WizardView
  restartClaude(): WizardView
  retryModel(): WizardView
  skipMicTest(): WizardView
  openChromeStore(browser: ChromeBrowser): WizardView
  checkChrome(): WizardView
  confirmChrome(): WizardView
  testBrowser(): WizardView
}

type WizardChannel =
  | typeof Channels.wizardGet
  | typeof Channels.wizardNext
  | typeof Channels.wizardBack
  | typeof Channels.wizardClaudeCheck
  | typeof Channels.wizardClaudeInstall
  | typeof Channels.wizardChooseFolder
  | typeof Channels.wizardTestClaude
  | typeof Channels.wizardRestartClaude
  | typeof Channels.wizardRetryModel
  | typeof Channels.wizardSkipMicTest
  | typeof Channels.wizardChromeOpen
  | typeof Channels.wizardChromeCheck
  | typeof Channels.wizardChromeConfirm
  | typeof Channels.wizardChromeTest

/**
 * The wizard page can read its progress, move through the steps, ask for the fixed Claude Code
 * install, open the folder picker, send the fixed test prompt, restart Claude, open the fixed
 * Web Store page in Chrome or Brave and send the fixed browser test. It can't choose what runs, supply a path or an address, or
 * choose the prompt's text, and nothing here changes any other setting (TECH_SPEC §6.1).
 */
export function registerWizardIpc(actions: WizardActions): void {
  const handle = <T>(
    channel: WizardChannel,
    schema: { safeParse(raw: unknown): { success: true; data: T } | { success: false } },
    act: (payload: T) => WizardView
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown): WizardResult => {
      if (!validateSender(event, ...SENDERS[channel])) return { ok: false, code: 'WIZARD_REFUSED' }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        log.warn(`Dropped an invalid IPC payload on ${channel}`)
        return { ok: false, code: 'WIZARD_REFUSED' }
      }
      return { ok: true, data: act(parsed.data) }
    })
  }
  const plain = (channel: WizardChannel, act: () => WizardView): void => {
    handle(channel, WizardAction, () => act())
  }
  plain(Channels.wizardGet, () => actions.view())
  plain(Channels.wizardNext, () => actions.next())
  plain(Channels.wizardBack, () => actions.back())
  plain(Channels.wizardClaudeCheck, () => actions.checkClaude())
  plain(Channels.wizardClaudeInstall, () => actions.installClaude())
  plain(Channels.wizardChooseFolder, () => actions.chooseFolder())
  plain(Channels.wizardTestClaude, () => actions.testClaude())
  plain(Channels.wizardRestartClaude, () => actions.restartClaude())
  plain(Channels.wizardRetryModel, () => actions.retryModel())
  plain(Channels.wizardSkipMicTest, () => actions.skipMicTest())
  handle(Channels.wizardChromeOpen, WizardChromeOpen, ({ browser }) =>
    actions.openChromeStore(browser)
  )
  plain(Channels.wizardChromeCheck, () => actions.checkChrome())
  plain(Channels.wizardChromeConfirm, () => actions.confirmChrome())
  plain(Channels.wizardChromeTest, () => actions.testBrowser())
}
