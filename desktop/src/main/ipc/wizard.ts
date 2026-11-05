import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { WizardAction } from '../../shared/ipc'
import { Channels, type WizardResult, type WizardView } from '../../shared/ipcChannels'
import { log } from '../log'
import { SENDERS } from './allowlist'
import { validateSender } from './validateSender'

export interface WizardActions {
  view(): WizardView
  next(): WizardView
  back(): WizardView
  checkClaude(): WizardView
  installClaude(): WizardView
}

type WizardChannel =
  | typeof Channels.wizardGet
  | typeof Channels.wizardNext
  | typeof Channels.wizardBack
  | typeof Channels.wizardClaudeCheck
  | typeof Channels.wizardClaudeInstall

/**
 * The wizard page can read its progress, move through the steps and ask for the fixed Claude Code
 * install. It can't choose what runs, and nothing here changes any other setting (TECH_SPEC §6.1).
 */
export function registerWizardIpc(actions: WizardActions): void {
  const handle = (channel: WizardChannel, act: () => WizardView): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown): WizardResult => {
      if (!validateSender(event, ...SENDERS[channel])) return { ok: false, code: 'WIZARD_REFUSED' }
      if (!WizardAction.safeParse(raw).success) {
        log.warn(`Dropped an invalid IPC payload on ${channel}`)
        return { ok: false, code: 'WIZARD_REFUSED' }
      }
      return { ok: true, data: act() }
    })
  }
  handle(Channels.wizardGet, () => actions.view())
  handle(Channels.wizardNext, () => actions.next())
  handle(Channels.wizardBack, () => actions.back())
  handle(Channels.wizardClaudeCheck, () => actions.checkClaude())
  handle(Channels.wizardClaudeInstall, () => actions.installClaude())
}
