import { Channels } from '../../shared/ipcChannels'
import type { WindowKind } from '../windows/factory'

type RendererChannel =
  typeof Channels.termInput | typeof Channels.termResize | typeof Channels.termAck

/** The window kinds allowed to send each renderer-to-main channel (TECH_SPEC §6.1). */
export const SENDERS: Readonly<Record<RendererChannel, readonly WindowKind[]>> = {
  [Channels.termInput]: ['terminal'],
  [Channels.termResize]: ['terminal'],
  [Channels.termAck]: ['terminal']
}
