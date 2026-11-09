import { app } from 'electron'
import type { ShutdownSteps } from '../core/shutdown'
import type { ExitReason } from '../core/updates'
import { log } from './log'
import type { AppUpdates, startAppUpdates } from './updater'

/**
 * Ties app updates (S7.4) to how VoiceUp exits: a downloaded update installs as the last shutdown
 * step, unless Windows is ending the session.
 */
export class UpdateControl {
  private exitReason: ExitReason = 'quit'
  private updates: AppUpdates | null = null

  constructor(steps: ShutdownSteps) {
    steps.update ??= () => {
      this.updates?.stop()
      this.updates?.installOnExit(this.exitReason)
    }
  }

  /** The first check waits 30 s, so it never competes with Claude starting. */
  start(startUpdates: typeof startAppUpdates, onReady: (version: string) => void): void {
    startUpdates(onReady)
      .then((started) => {
        this.updates = started
      })
      .catch((error: unknown) => {
        log.error('App updates could not start; this copy will not update', error)
      })
  }

  sessionEnding(): void {
    this.exitReason = 'sessionEnd'
  }

  /** The tray's Restart to update: quits, and the installer starts the new version. */
  restart(): void {
    this.exitReason = 'restart'
    app.quit()
  }
}
