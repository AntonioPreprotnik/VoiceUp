import { join } from 'node:path'
import { app, session, type BrowserWindow } from 'electron'
import type { ShutdownSteps } from '../core/shutdown'
import { parseSmokeTestPath } from '../core/smokeTest'
import { RecorderDevices } from '../shared/ipc'
import { Channels, type MicDevice } from '../shared/ipcChannels'
import { installShutdown } from './appShutdown'
import { createClaudeLink } from './claudeLink'
import { exposeForE2e } from './e2eHook'
import { on } from './ipc/terminal'
import { initLogging, log, setLogLevel } from './log'
import { applySettingsChanges, BACKGROUND_FLAG } from './settingsEffects'
import { installAppMenu, installSessionMenu } from './menu'
import { Overlay } from './overlay'
import { installPermissions } from './permissions'
import { installProcessErrorLogging } from './processErrors'
import { registerAppScheme, serveAppProtocol } from './protocol'
import { SettingsScreen } from './settings/settingsScreen'
import { SettingsStore } from './settings/settingsStore'
import { loadSettings, saveSettings } from './settings/store'
import { runSmokeTest } from './smokeTest'
import { createVoice } from './voice'
import { startAppUpdates } from './updater'
import type { Wizard } from './wizard'
import { launchWizard } from './wizardLaunch'
import { setUpClaudeSession } from './claudeSessionSetup'
import { HotkeyControl } from './hotkeyControl'
import { keepInTrayOnClose } from './trayClose'
import { UpdateControl } from './updateControl'
import { createWindow, loadRenderer, windowKindOf } from './windows/factory'

function failStartup(error: unknown): void {
  log.error('Startup failed', error)
  app.exit(1)
}

export { BACKGROUND_FLAG } from './settingsEffects'

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export interface StartOptions {
  readonly argv?: readonly string[]
  /** Later stories add their steps here as they arrive. */
  readonly shutdownSteps?: ShutdownSteps
  /** Tests pass a fake; only an installed copy starts the real one. */
  readonly startUpdates?: typeof startAppUpdates
}

/** The startup order from TECH_SPEC §3. */
export function startApp({
  argv = process.argv,
  shutdownSteps = {},
  startUpdates = startAppUpdates
}: StartOptions = {}): void {
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
  let wizardWindow: BrowserWindow | undefined
  let wizard: Wizard | undefined
  // The terminal stays blank and hidden until the wizard is finished, so never bring it up before.
  const focusFront = (): void => {
    const front = wizardWindow ?? mainWindow
    if (front !== undefined) focusWindow(front)
  }
  app.on('second-instance', focusFront)
  app.on('window-all-closed', () => {
    app.quit()
  })
  const steps: ShutdownSteps = { ...shutdownSteps }
  installShutdown(steps)
  const updateControl = new UpdateControl(steps)

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

      // The one copy of the settings from here on. Nothing reads the loaded object again.
      const store = new SettingsStore(settings, (changed) => {
        saveSettings(app.getPath('userData'), changed)
      })
      // Started by Windows at sign-in (S7.1): straight to the tray, with Claude and the hotkey ready.
      const background = argv.includes(BACKGROUND_FLAG) && store.current.wizard.done
      if (background) log.info('Started in the background')
      const terminalWindow = createWindow('terminal', { showWhenReady: !background })
      mainWindow = terminalWindow
      const recorderWindow = createWindow('recorder', { showWhenReady: false })
      const overlayWindow = createWindow('overlay', { showWhenReady: false })
      const overlay = new Overlay({ window: overlayWindow, sounds: store.current.ui.sounds })
      loadRenderer(overlayWindow, 'overlay').catch((error: unknown) => {
        log.error('Could not load the overlay window', error)
      })
      const {
        claudeState,
        delivery,
        hooks,
        publishStatus,
        setNotifications,
        setListeningPaused,
        stillRunning,
        updateReady
      } = createClaudeLink({
        settings: store,
        overlay,
        terminalWindow,
        parentWindow: () => mainWindow,
        showWindow: focusFront,
        openSettings: () => {
          openSettings()
        },
        pauseListening: (paused) => {
          hotkeys.setPaused(paused)
          setListeningPaused(hotkeys.isPaused)
          settingsScreen.refresh()
        },
        restartToUpdate: () => {
          updateControl.restart()
        },
        write: (data) => {
          claude.host.write(data)
        },
        steps,
        onClaudeState: (state) => {
          wizard?.onClaudeState(state)
        },
        onHook: (message) => {
          wizard?.onHook(message)
        }
      })
      updateControl.start(startUpdates, updateReady)
      // Step 5: the speech worker that the hidden window streams to.
      const { recording, models, applySpeechSettings } = createVoice({
        settings: store,
        overlay,
        recorderWindow,
        delivery,
        voiceBlock: () => hooks.voiceBlock,
        micDeviceId: () => claude.micDeviceId,
        progressWindow: () => mainWindow,
        // While the wizard is open, what the hotkey hears is its microphone test, never Claude's.
        divert: () =>
          wizard === undefined
            ? null
            : (text) => {
                wizard?.onTranscript(text)
              },
        onVoiceFailed: (code) => {
          wizard?.onVoiceFailed(code)
        },
        onModelStatus: () => {
          wizard?.onModelStatus()
          settingsScreen.refresh()
        },
        rebuildMenu: () => {
          rebuildMenu()
        },
        steps
      })

      // Step 6: Claude, in the terminal.
      const claude = setUpClaudeSession({
        window: terminalWindow,
        settings: store,
        link: { claudeState, delivery, hooks, publishStatus },
        steps
      })
      let microphones: readonly MicDevice[] = []
      // Rebuilt when the wizard finishes.
      const rebuildMenu = (): void => {
        installSessionMenu(store.current.wizard.done, {
          changeFolder: () => claude.changeFolder(),
          changeFontSize: (change) => {
            claude.changeFontSize(change)
          },
          // Defined below, and this runs at once.
          openSettings: () => {
            openSettings()
          }
        })
      }
      rebuildMenu()
      on(Channels.recorderDevices, RecorderDevices, (devices) => {
        microphones = devices
        settingsScreen.refresh()
      })
      keepInTrayOnClose({
        window: terminalWindow,
        isSetUp: () => store.current.wizard.done,
        onFirstHide: stillRunning,
        onSessionEnd: () => {
          updateControl.sessionEnding()
        }
      })
      // window-all-closed can't quit: the hidden recorder stays open.
      mainWindow.once('closed', () => {
        mainWindow = undefined
        app.quit()
      })
      // Loading this page is what starts Claude, and the window shows once it has loaded.
      let terminalLoad: Promise<void> | undefined
      const loadTerminal = (): Promise<void> =>
        (terminalLoad ??= loadRenderer(terminalWindow, 'terminal'))
      const hotkeys = new HotkeyControl({
        store,
        steps,
        window: terminalWindow,
        press: () => {
          recording.press()
        },
        cancelRecording: () => {
          recording.cancel()
        }
      })
      const settingsScreen = new SettingsScreen({
        store,
        microphones: () => microphones,
        models: () => models.choices(),
        model: () => models.chosenStatus(),
        retryModel: () => {
          models.ensure()
        },
        changeHotkey: (next) => hotkeys.change(next),
        hotkeyOn: () => hotkeys.hotkeyOn,
        canStartWithWindows: app.isPackaged
      })
      // Not during setup: the wizard owns these choices until it finishes.
      const openSettings = (): void => {
        if (store.current.wizard.done) settingsScreen.open()
        else focusFront()
      }
      applySettingsChanges(store, {
        setSounds: (on) => {
          overlay.setSounds(on)
        },
        setNotifications,
        selectModel: (id) => {
          models.select(id)
        },
        applySpeechSettings
      })
      const openTerminal = async (): Promise<void> => {
        await loadTerminal()
        // The e2e tests have no model and no network, so nothing downloads for them.
        if (exposeForE2e(delivery, claudeState)) return
        // After the load, which would otherwise replace the title showing the progress.
        models.ensure()

        // Step 7: the global hotkey, last, so a press always finds everything running.
        hotkeys.startOrReport()
      }
      if (store.current.wizard.done) {
        await openTerminal()
        return
      }
      wizard = launchWizard({
        settings: store,
        terminalWindow,
        claude,
        link: { claudeState, delivery },
        models,
        hotkeys,
        loadTerminal,
        onFinished: () => {
          wizardWindow = undefined
          wizard = undefined
          rebuildMenu()
          openTerminal().catch(failStartup)
        },
        onAbandoned: () => {
          wizardWindow = undefined
          wizard = undefined
          app.quit()
        },
        onStartFailed: failStartup
      })
      wizardWindow = wizard.window
      await loadRenderer(wizardWindow, 'wizard')
    })
    .catch(failStartup)
}
