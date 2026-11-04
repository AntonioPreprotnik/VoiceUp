import { ipcMain } from 'electron'
import { QueueCancel, StateReArm } from '../../shared/ipc'
import { Channels, type StatusView } from '../../shared/ipcChannels'
import { SENDERS } from './allowlist'
import { on } from './terminal'
import { validateSender } from './validateSender'

/** The status bar: the state now, for a page that loads after it changed, re-arm and the queue. */
export function registerStatusIpc(
  getView: () => StatusView | undefined,
  reArm: () => void,
  cancelQueued: (id: string) => void
): void {
  on(Channels.stateReArm, StateReArm, () => {
    reArm()
  })
  on(Channels.queueCancel, QueueCancel, ({ id }) => {
    cancelQueued(id)
  })
  ipcMain.handle(Channels.stateGet, (event) =>
    validateSender(event, ...SENDERS[Channels.stateGet]) ? (getView() ?? null) : null
  )
}
