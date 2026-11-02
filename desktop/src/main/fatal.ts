import { app, dialog } from 'electron'
import { MESSAGES } from '../core/messages'
import { parseSmokeTestPath } from '../core/smokeTest'

/**
 * Reports an error the app can't recover from, then exits 1. Without this, Electron shows its own
 * dialog and leaves the process running with no window. This file imports no packages, so it still
 * works when one of them is what failed to load. A smoke test gets no dialog, which would hang it.
 */
export function exitFatally(error: unknown): void {
  console.error('APP_START_FAILED', error)
  if (parseSmokeTestPath(process.argv) === undefined) {
    const { title, detail } = MESSAGES.APP_START_FAILED
    dialog.showErrorBox(title, `${detail}\n\n${String(error)}`)
  }
  app.exit(1)
}
