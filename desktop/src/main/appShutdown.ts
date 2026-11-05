import { app } from 'electron'
import { runShutdown, type ShutdownSteps } from '../core/shutdown'
import { log } from './log'

const SHUTDOWN_WATCHDOG_MS = 5000

/** TECH_SPEC §3 shutdown. A watchdog force-exits so a hung child never keeps the app alive. */
export function installShutdown(steps: ShutdownSteps): void {
  let shuttingDown = false
  app.on('before-quit', (event) => {
    // Electron would quit right after this handler; app.exit below ends the process instead.
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true

    const watchdog = setTimeout(() => {
      log.error(`Shutdown still running after ${String(SHUTDOWN_WATCHDOG_MS)} ms, forcing exit`)
      app.exit(1)
    }, SHUTDOWN_WATCHDOG_MS)

    void runShutdown(steps, (step, error) => {
      log.error(`Shutdown step ${step} failed`, error)
    }).then(() => {
      clearTimeout(watchdog)
      app.exit(0)
    })
  })
}
