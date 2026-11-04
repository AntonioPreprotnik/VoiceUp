import { ipcMain } from 'electron'
import { StateReArm } from '../../shared/ipc'
import { Channels, type StatusView } from '../../shared/ipcChannels'
import { SENDERS } from './allowlist'
import { on } from './terminal'
import { validateSender } from './validateSender'

/** The status bar: the state now, for a page that loads after it changed, and re-arm. */
export function registerStatusIpc(getView: () => StatusView | undefined, reArm: () => void): void {
  on(Channels.stateReArm, StateReArm, () => {
    reArm()
  })
  ipcMain.handle(Channels.stateGet, (event) =>
    validateSender(event, ...SENDERS[Channels.stateGet]) ? (getView() ?? null) : null
  )
}
