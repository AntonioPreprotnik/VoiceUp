import { isKnownPtyKillRejection } from '../core/knownRejections'
import { log } from './log'

/** Logs every unhandled rejection. index.ts already handles uncaught exceptions as fatal. */
export function installProcessErrorLogging(): void {
  process.on('unhandledRejection', (reason) => {
    if (isKnownPtyKillRejection(reason)) {
      log.debug('Known node-pty kill rejection under the runAsNode fuse (decision note S0.6)')
      return
    }
    log.error('Unhandled rejection', reason)
  })
  // Runs before the fatal handler, so the error also reaches the log file.
  process.prependListener('uncaughtException', (error) => {
    log.error('Uncaught exception', error)
  })
}
