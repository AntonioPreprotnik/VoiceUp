import { join } from 'node:path'
import { app, session, type BrowserWindow } from 'electron'
import { MESSAGES } from '../core/messages'
import { runShutdown, type ShutdownSteps } from '../core/shutdown'
import { parseSmokeTestPath } from '../core/smokeTest'
import { registerTerminalIpc } from './ipc/terminal'
import { registerTerminalUiIpc } from './ipc/terminalUi'
import { initLogging, log, setLogLevel } from './log'
import { installAppMenu } from './menu'
import { denyAllPermissions } from './permissions'
import { installProcessErrorLogging } from './processErrors'
import { registerAppScheme, serveAppProtocol } from './protocol'
import { resolveClaude } from './pty/resolveClaude'
import { ClaudeSession } from './pty/session'
import { loadSettings } from './settings/store'
import { SpeechSupervisor } from './speech/supervisor'
import { workerInit } from './speech/workerInit'
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

/** The startup order from TECH_SPEC §3. Steps 4 and 7 arrive with their stories. */
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
  installProcessErrorLogging()
  log.info(`VoiceUp ${app.getVersion()} starting`)
  const settings = smokeTestPath === undefined ? loadSettings(app.getPath('userData'), log) : null
  if (settings !== null) setLogLevel(settings.logLevel)

  // Step 3: the scheme must be registered before app ready.
  registerAppScheme()

  let mainWindow: BrowserWindow | undefined
  app.on('second-instance', () => {
    if (mainWindow !== undefined) focusWindow(mainWindow)
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  const steps: ShutdownSteps = { ...shutdownSteps }
  installShutdown(steps)

  app
    .whenReady()
    .then(async () => {
      denyAllPermissions(session.defaultSession)
      serveAppProtocol(join(__dirname, '../renderer'))

      if (settings === null) {
        installAppMenu()
        await runSmokeTest(smokeTestPath ?? '')
        return
      }

      mainWindow = createWindow('terminal')
      // Step 5: the speech worker. Recordings arrive with the recorder window in S3.2.
      const speech = new SpeechSupervisor({
        onEvent: (event) => {
          if (event.type === 'ready') log.info(`Speech worker ready in ${String(event.loadMs)} ms`)
          if (event.type === 'error') log.warn(`Speech worker error: ${event.code}`)
        },
        onGaveUp: () => {
          log.error(MESSAGES.WORKER_CRASHED.title)
        }
      })
      speech.start(workerInit(settings.speech))
      steps.worker ??= () => speech.stop()

      // Step 6: Claude itself starts at the renderer's first size, so it never draws at a wrong one.
      const claude = new ClaudeSession({
        window: mainWindow,
        settings,
        settingsDir: app.getPath('userData'),
        resolveCommand: () => resolveClaude(app.isPackaged)
      })
      registerTerminalIpc(claude.host)
      steps.pty ??= () => claude.host.stop()
      registerTerminalUiIpc(mainWindow, () => claude.fontSize)
      installAppMenu({
        changeFolder: () => claude.changeFolder(),
        changeFontSize: (change) => {
          claude.changeFontSize(change)
        }
      })
      mainWindow.once('closed', () => {
        mainWindow = undefined
      })
      await loadRenderer(mainWindow, 'terminal')
    })
    .catch(failStartup)
}
