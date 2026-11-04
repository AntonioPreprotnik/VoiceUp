import { app } from 'electron'
import type { Delivery } from '../core/delivery/delivery'
import type { ClaudeStateTracker } from '../core/state/tracker'

/**
 * For the end-to-end tests, which have no microphone and no model. It can type into Claude, so a
 * packaged build never has it, whatever the environment says. Returns whether it was added.
 */
export function exposeForE2e(delivery: Delivery, claude: ClaudeStateTracker): boolean {
  if (app.isPackaged || process.env['VOICEUP_E2E'] !== '1') return false
  Object.assign(globalThis, {
    voiceupE2e: {
      deliver: (text: string) => {
        delivery.deliver(text)
      },
      retry: () => {
        delivery.retry()
      },
      discard: () => {
        delivery.discard()
      },
      status: () => ({
        state: claude.state,
        promptDirty: claude.promptDirty,
        holding: delivery.holding,
        queue: delivery.queued.map(({ text }) => text)
      })
    }
  })
  return true
}
