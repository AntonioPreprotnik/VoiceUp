import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { isTrustedRendererUrl } from '../../core/appUrl'
import { log } from '../log'
import { rendererMode } from '../rendererMode'
import { windowKindOf, type WindowKind } from '../windows/factory'

/**
 * Security rule 8: every IPC handler calls this first. The sending frame must be on a trusted
 * origin and belong to a window kind this channel allows. Otherwise it logs and returns false,
 * and the handler drops the message.
 */
export function validateSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  ...allowedKinds: readonly WindowKind[]
): boolean {
  const kind = windowKindOf(event.sender.id)
  const frameUrl = event.senderFrame?.url
  const trusted =
    kind !== undefined &&
    allowedKinds.includes(kind) &&
    frameUrl !== undefined &&
    isTrustedRendererUrl(frameUrl, rendererMode())

  if (!trusted) {
    log.warn(
      `Dropped IPC from an untrusted sender: webContents ${String(event.sender.id)}, ` +
        `kind ${String(kind)}, frame ${String(frameUrl)}`
    )
  }
  return trusted
}
