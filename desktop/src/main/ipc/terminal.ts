import { ipcMain, type IpcMainEvent } from 'electron'
import type { ZodType } from 'zod'
import { SessionRestart, TermAck, TermInput, TermResize } from '../../shared/ipc'
import { Channels } from '../../shared/ipcChannels'
import { log } from '../log'
import type { PtyHost } from '../pty/host'
import { SENDERS } from './allowlist'
import { validateSender } from './validateSender'

type RendererChannel = keyof typeof SENDERS

/** Security rule 8: every message passes the sender check, then its schema, or it is dropped. */
export function on<T>(
  channel: RendererChannel,
  schema: ZodType<T>,
  handle: (payload: T) => void
): void {
  ipcMain.on(channel, (event: IpcMainEvent, raw: unknown) => {
    if (!validateSender(event, ...SENDERS[channel])) return
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      // The payload may be what the user typed, so it is never logged.
      log.warn(`Dropped an invalid IPC payload on ${channel}`)
      return
    }
    handle(parsed.data)
  })
}

/** `onInput` sees each keystroke before Claude does, because the state depends on some of them. */
export function registerTerminalIpc(host: PtyHost, onInput: (data: string) => void): void {
  on(Channels.termInput, TermInput, (data) => {
    onInput(data)
    host.write(data)
  })
  on(Channels.termResize, TermResize, (size) => {
    host.resize(size)
  })
  on(Channels.termAck, TermAck, (chars) => {
    host.acknowledge(chars)
  })
  on(Channels.sessionRestart, SessionRestart, () => {
    host.restart().catch((error: unknown) => {
      log.error('Could not restart the session', error)
    })
  })
}
