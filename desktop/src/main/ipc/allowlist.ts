import { Channels } from '../../shared/ipcChannels'
import type { WindowKind } from '../windows/factory'

type RendererChannel =
  | typeof Channels.termInput
  | typeof Channels.termResize
  | typeof Channels.termAck
  | typeof Channels.sessionRestart
  | typeof Channels.stateGet
  | typeof Channels.stateReArm
  | typeof Channels.queueCancel
  | typeof Channels.clipboardWrite
  | typeof Channels.clipboardRead
  | typeof Channels.linkOpen
  | typeof Channels.termContextMenu
  | typeof Channels.settingsFontSize
  | typeof Channels.recorderError
  | typeof Channels.recorderDevices
  | typeof Channels.settingsGet
  | typeof Channels.settingsSet
  | typeof Channels.settingsReset
  | typeof Channels.settingsRetryModel
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

/** The window kinds allowed to send each renderer-to-main channel (TECH_SPEC §6.1). */
export const SENDERS: Readonly<Record<RendererChannel, readonly WindowKind[]>> = {
  [Channels.termInput]: ['terminal'],
  [Channels.termResize]: ['terminal'],
  [Channels.termAck]: ['terminal'],
  [Channels.sessionRestart]: ['terminal'],
  [Channels.stateGet]: ['terminal'],
  [Channels.stateReArm]: ['terminal'],
  [Channels.queueCancel]: ['terminal'],
  [Channels.clipboardWrite]: ['terminal'],
  [Channels.clipboardRead]: ['terminal'],
  [Channels.linkOpen]: ['terminal'],
  [Channels.termContextMenu]: ['terminal'],
  [Channels.settingsFontSize]: ['terminal'],
  [Channels.recorderError]: ['recorder'],
  [Channels.recorderDevices]: ['recorder'],
  [Channels.settingsGet]: ['settings'],
  [Channels.settingsSet]: ['settings'],
  [Channels.settingsReset]: ['settings'],
  [Channels.settingsRetryModel]: ['settings'],
  [Channels.wizardGet]: ['wizard'],
  [Channels.wizardNext]: ['wizard'],
  [Channels.wizardBack]: ['wizard'],
  [Channels.wizardClaudeCheck]: ['wizard'],
  [Channels.wizardClaudeInstall]: ['wizard'],
  [Channels.wizardChooseFolder]: ['wizard'],
  [Channels.wizardTestClaude]: ['wizard'],
  [Channels.wizardRestartClaude]: ['wizard'],
  [Channels.wizardRetryModel]: ['wizard'],
  [Channels.wizardSkipMicTest]: ['wizard']
}
