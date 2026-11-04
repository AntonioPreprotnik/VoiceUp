import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, dialog, net, session, type BrowserWindow } from 'electron'
import { MESSAGES } from '../core/messages'
import { RecordingToggle } from '../core/recordingToggle'
import { runShutdown, type ShutdownSteps } from '../core/shutdown'
import { parseSmokeTestPath } from '../core/smokeTest'
import { statusView } from '../core/state/status'
import { ClaudeStateTracker } from '../core/state/tracker'
import { RecorderDevices } from '../shared/ipc'
import { Channels, type MicDevice } from '../shared/ipcChannels'
import { HookLink } from './hooks/link'
import { readHookPolicies } from './hooks/policy'
import { escapeKey, registerHotkey, reportHotkeyTaken, unregisterHotkeys } from './hotkey'
import { registerStatusIpc } from './ipc/status'
import { on, registerTerminalIpc } from './ipc/terminal'
import { registerTerminalUiIpc } from './ipc/terminalUi'
import { initLogging, log, setLogLevel } from './log'
import { installAppMenu } from './menu'
import { loadManifest, ModelController, modelTitle } from './models/controller'
import { ModelManager } from './models/manager'
import { Overlay } from './overlay'
import { installPermissions } from './permissions'
import { installProcessErrorLogging } from './processErrors'
import { registerAppScheme, serveAppProtocol } from './protocol'
import { resolveClaude, system32Path } from './pty/resolveClaude'
import { ClaudeSession } from './pty/session'
import { loadSettings } from './settings/store'
import { RecordingController } from './speech/recording'
import { SpeechSupervisor } from './speech/supervisor'
import { workerInit } from './speech/workerInit'
import { runSmokeTest } from './smokeTest'
import { ClaudeStatus } from './status'
import { createWindow, loadRenderer, windowKindOf } from './windows/factory'

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

/** The startup order from TECH_SPEC §3. */
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
  // Windows names the app in its notifications from this. Matches appId in electron-builder.yml.
  app.setAppUserModelId('app.voiceup.desktop')
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
      installPermissions(session.defaultSession, (id) => windowKindOf(id) === 'recorder')
      serveAppProtocol(join(__dirname, '../renderer'))

      if (settings === null) {
        installAppMenu()
        await runSmokeTest(smokeTestPath ?? '')
        return
      }

      const terminalWindow = createWindow('terminal')
      mainWindow = terminalWindow
      const recorderWindow = createWindow('recorder', { showWhenReady: false })
      const overlayWindow = createWindow('overlay', { showWhenReady: false })
      const overlay = new Overlay({ window: overlayWindow, sounds: settings.ui.sounds })
      loadRenderer(overlayWindow, 'overlay').catch((error: unknown) => {
        log.error('Could not load the overlay window', error)
      })
      const claudeState = new ClaudeStateTracker({
        schedule: (callback, ms) => {
          const timer = setTimeout(callback, ms)
          return () => {
            clearTimeout(timer)
          }
        },
        onChange: (state, previous) => {
          log.debug(`Claude state: ${previous} -> ${state}`)
          publishStatus()
          claudeStatus.notify(previous, state)
        },
        onEffect: (effect) => {
          // Only a short code from Claude. Anything else might quote more than it should.
          const code = /^[a-z_]{1,40}$/.test(effect.error ?? '') ? effect.error : 'other'
          log.warn(`Claude's turn failed: ${String(code)}`)
        }
      })
      const claudeStatus = new ClaudeStatus({
        window: terminalWindow,
        notifications: settings.ui.notifications,
        reArm: () => {
          claudeState.reArm()
        },
        showWindow: () => {
          focusWindow(terminalWindow)
        },
        quit: () => {
          app.quit()
        }
      })
      steps.tray ??= () => {
        claudeStatus.destroy()
      }
      const publishStatus = (): void => {
        claudeStatus.show(statusView(claudeState.state, hooks.voiceBlock))
      }
      registerStatusIpc(
        () => claudeStatus.current,
        () => {
          claudeState.reArm()
        }
      )
      // Step 4: stale files go, then the hook server and this launch's hook files.
      const hooks = new HookLink({
        runDir: join(app.getPath('userData'), 'run'),
        curlPath: system32Path('curl.exe'),
        readPolicies: (projectDir) => readHookPolicies({ projectDir }),
        onMessage: (message) => {
          if (message.kind === 'hook' && message.hook.hook_event_name === 'SessionStart') {
            log.info('Claude session started')
          }
          claudeState.onHook(message)
        },
        onUnavailable: (code, setting) => {
          publishStatus()
          const { title, detail } = MESSAGES[code]
          if (mainWindow === undefined) return
          dialog
            .showMessageBox(mainWindow, {
              type: 'warning',
              title: 'VoiceUp',
              message: title,
              detail: setting === null ? detail : `Setting: ${setting}. ${detail}`
            })
            .catch((error: unknown) => {
              log.error('Could not show the hooks message', error)
            })
        },
        onStartingSlow: () => {
          overlay.failed('STARTING_SLOW')
        }
      })
      steps.hookServer ??= () => hooks.stopServer()
      steps.hookFiles ??= () => {
        hooks.removeFiles()
      }
      publishStatus()
      // Step 5: the speech worker that the hidden window streams to.
      const recording = new RecordingController({
        toggle: new RecordingToggle(randomUUID),
        sendToWorker: (command) => {
          speech.send(command)
        },
        workerRunning: () => speech.running,
        restartWorker: () => {
          speech.restart()
        },
        recorder: recorderWindow.webContents,
        getDeviceId: () => claude.micDeviceId,
        minWords: settings.speech.minWords,
        voiceBlock: () => hooks.voiceBlock,
        overlay,
        escape: escapeKey
      })
      const speech = new SpeechSupervisor({
        onEvent: (event) => {
          if (event.type === 'ready') log.info(`Speech worker ready in ${String(event.loadMs)} ms`)
          if (event.type === 'error')
            log.warn(`Speech worker error: ${event.code}: ${event.message}`)
          recording.onWorkerEvent(event)
        },
        onCrash: () => {
          recording.workerLost()
        },
        onGaveUp: () => {
          log.error(MESSAGES.WORKER_CRASHED.title)
          overlay.failed('WORKER_CRASHED')
        }
      })
      let shownPhase = 'idle'
      const models = new ModelController({
        manifest: loadManifest(),
        manager: new ModelManager({
          root: join(app.getPath('userData'), 'models'),
          fetch: (url, init) => net.fetch(url, init)
        }),
        modelId: settings.speech.modelId,
        onStatus: (status) => {
          if (mainWindow === undefined) return
          mainWindow.setTitle(modelTitle(status))
          mainWindow.setProgressBar(status.phase === 'installing' ? status.percent / 100 : -1)
          // The menu has no percentage, so it changes only with the phase.
          if (status.phase !== shownPhase) {
            shownPhase = status.phase
            rebuildMenu()
          }
        },
        onReady: (model) => {
          // Whatever is being recorded can't be finished by a worker about to go.
          recording.cancel()
          speech.restart(workerInit(settings.speech, model))
          rebuildMenu()
        },
        onFailed: (code) => {
          overlay.failed(code)
        }
      })
      speech.start(workerInit(settings.speech, models.installedModel()))
      steps.worker ??= () => speech.stop()

      // After the load: a port sent earlier arrives before the preload listens, and is lost.
      recorderWindow.webContents.once('did-finish-load', () => {
        speech.connectRecorder(recorderWindow.webContents)
      })
      // The hidden window has nowhere else to report a problem. It never logs audio or text.
      recorderWindow.webContents.on('console-message', ({ level, message }) => {
        if (level === 'warning' || level === 'error') log.warn(`Recorder: ${message}`)
      })
      loadRenderer(recorderWindow, 'recorder').catch((error: unknown) => {
        log.error('Could not load the recorder window', error)
      })

      // Step 6: Claude itself starts at the renderer's first size, so it never draws at a wrong one.
      const claude = new ClaudeSession({
        window: mainWindow,
        settings,
        settingsDir: app.getPath('userData'),
        resolveCommand: () => resolveClaude(app.isPackaged),
        hooks: {
          prepareLaunch: (cwd) => hooks.prepareLaunch(cwd),
          launched: () => {
            claudeState.sessionRestart()
            hooks.launched()
            publishStatus()
          },
          exited: () => {
            claudeState.ptyExit()
            hooks.exited()
          }
        }
      })
      registerTerminalIpc(claude.host, (data) => {
        claudeState.onInput(data)
      })
      steps.pty ??= () => claude.host.stop()
      registerTerminalUiIpc(mainWindow, () => claude.fontSize)
      let microphones: readonly MicDevice[] = []
      const rebuildMenu = (): void => {
        installAppMenu({
          changeFolder: () => claude.changeFolder(),
          changeFontSize: (change) => {
            claude.changeFontSize(change)
          },
          microphones,
          selectedMicrophone: claude.micDeviceId,
          selectMicrophone: (deviceId) => {
            claude.setMicDevice(deviceId)
            rebuildMenu()
          },
          speechModel: {
            ...models.menu(),
            select: (id) => {
              claude.setModel(id)
              models.select(id)
              rebuildMenu()
            },
            retry: () => {
              models.ensure()
            }
          }
        })
      }
      rebuildMenu()
      on(Channels.recorderDevices, RecorderDevices, (devices) => {
        microphones = devices
        rebuildMenu()
      })
      // Closing the terminal quits. window-all-closed can't do it: the hidden recorder stays open.
      mainWindow.once('closed', () => {
        mainWindow = undefined
        app.quit()
      })
      await loadRenderer(mainWindow, 'terminal')
      // After the load, which would otherwise replace the title showing the progress.
      models.ensure()

      // Step 7: the global hotkey, last, so a press always finds everything running.
      const { hotkey } = settings
      steps.shortcuts ??= unregisterHotkeys
      const registered = registerHotkey(hotkey, () => {
        recording.press()
      })
      if (!registered) reportHotkeyTaken(mainWindow, hotkey)
    })
    .catch(failStartup)
}
