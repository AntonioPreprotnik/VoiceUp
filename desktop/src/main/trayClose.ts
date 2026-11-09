import { app, type BrowserWindow } from 'electron'
import { log } from './log'

export interface TrayCloseOptions {
  readonly window: BrowserWindow
  /** During setup, closing still quits. */
  readonly isSetUp: () => boolean
  /** Once per run, when the window first goes to the tray. */
  readonly onFirstHide: () => void
  /** Windows is signing out or shutting down. */
  readonly onSessionEnd: () => void
}

/**
 * Closing the terminal hides it in the tray once set up (S7.1), and Claude keeps running. Quit,
 * signing out and shutting down still close it for real.
 */
export function keepInTrayOnClose({
  window,
  isSetUp,
  onFirstHide,
  onSessionEnd
}: TrayCloseOptions): void {
  let quitting = false
  let toldStillRunning = false
  app.on('before-quit', () => {
    quitting = true
  })
  const endingSession = (): void => {
    quitting = true
    onSessionEnd()
  }
  window.on('query-session-end', endingSession)
  window.on('session-end', endingSession)
  window.on('close', (event) => {
    if (quitting || !isSetUp()) return
    event.preventDefault()
    window.hide()
    log.info('Window hidden in the tray')
    if (!toldStillRunning) {
      toldStillRunning = true
      onFirstHide()
    }
  })
}
