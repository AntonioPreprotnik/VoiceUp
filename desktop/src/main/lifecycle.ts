import { join } from 'node:path'
import { app, session, type BrowserWindow } from 'electron'
import { runShutdown, type ShutdownSteps } from '../core/shutdown'
import { parseSmokeTestPath } from '../core/smokeTest'
import { initLogging, log, setLogLevel } from './log'
import { installAppMenu } from './menu'
import { denyAllPermissions } from './permissions'
import { registerAppScheme, serveAppProtocol } from './protocol'
import { loadSettings } from './settings/store'
import { runSmokeTest } from './smokeTest'
import { createWindow, loadRenderer } from './windows/factory'

const SHUTDOWN_WATCHDOG_MS = 5000

function failStartup(error: unknown): void {
  log.error('Startup failed', error)
  app.exit(1)
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** TECH_SPEC §3 shutdown. A watchdog force-exits so a hung child never keeps the app alive. */
function installShutdown(steps: ShutdownSteps): void {
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

export interface StartOptions {
  readonly argv?: readonly string[]
  /** Later stories add their steps here as they arrive. */
  readonly shutdownSteps?: ShutdownSteps
}

/** The startup order from TECH_SPEC §3. Steps 4 to 7 arrive with their stories. */
export function startApp({ argv = process.argv, shutdownSteps = {} }: StartOptions = {}): void {
  const smokeTestPath = parseSmokeTestPath(argv)

  // Step 1: single-instance lock. A smoke test skips it so it can run beside an open copy.
  if (smokeTestPath === undefined && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  // Step 2: logs first, so a settings problem can be logged. A smoke test leaves settings alone,
  // because it may run beside an open copy that owns the file.
  initLogging()
  log.info(`VoiceUp ${app.getVersion()} starting`)
  if (smokeTestPath === undefined) {
    setLogLevel(loadSettings(app.getPath('userData'), log).logLevel)
  }

  // Step 3: the scheme must be registered before app ready.
  registerAppScheme()

  let mainWindow: BrowserWindow | undefined
  app.on('second-instance', () => {
    if (mainWindow !== undefined) focusWindow(mainWindow)
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  installShutdown(shutdownSteps)

  app
    .whenReady()
    .then(async () => {
      denyAllPermissions(session.defaultSession)
      serveAppProtocol(join(__dirname, '../renderer'))
      installAppMenu()

      if (smokeTestPath !== undefined) {
        await runSmokeTest(smokeTestPath)
        return
      }

      mainWindow = createWindow('terminal')
      mainWindow.once('closed', () => {
        mainWindow = undefined
      })
      await loadRenderer(mainWindow, 'terminal')
    })
    .catch(failStartup)
}
