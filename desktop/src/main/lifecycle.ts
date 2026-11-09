import { join } from 'node:path'
import { app, screen, session, type BrowserWindow } from 'electron'
import { sideBySide } from '../core/sideBySide'
import type { ShutdownSteps } from '../core/shutdown'
import type { ExitReason } from '../core/updates'
import { parseSmokeTestPath } from '../core/smokeTest'
import { RecorderDevices } from '../shared/ipc'
import { Channels, type ChromeBrowser, type MicDevice } from '../shared/ipcChannels'
import { installShutdown } from './appShutdown'
import { createClaudeLink } from './claudeLink'
import { registerHotkey, reportHotkeyTaken, unregisterHotkey, unregisterHotkeys } from './hotkey'
import { Listening } from '../core/listening'
import { exposeForE2e } from './e2eHook'
import { on, registerTerminalIpc } from './ipc/terminal'
import { registerTerminalUiIpc } from './ipc/terminalUi'
import { initLogging, log, setLogLevel } from './log'
import { applySettingsChanges, BACKGROUND_FLAG } from './settingsEffects'
import { installAppMenu } from './menu'
import { Overlay } from './overlay'
import { installPermissions } from './permissions'
import { installProcessErrorLogging } from './processErrors'
import { registerAppScheme, serveAppProtocol } from './protocol'
import { readClaudeVersion } from './pty/claudeVersion'
import { installScript, runInstaller } from './pty/installClaude'
import { isDirectory, pickProjectFolder } from './pty/projectFolder'
import { resolveClaude } from './pty/resolveClaude'
import { ClaudeSession } from './pty/session'
import { SettingsScreen } from './settings/settingsScreen'
import { SettingsStore } from './settings/settingsStore'
import { loadSettings, saveSettings } from './settings/store'
import { runSmokeTest } from './smokeTest'
import { createVoice } from './voice'
import { schedule } from './schedule'
import { startAppUpdates, type AppUpdates } from './updater'
import { openWizard, type Wizard } from './wizard'
import { browserPlaces, findBrowsers, openForTest, openStore } from './browser/chromeExtension'
import { browserForTest, browserFromAppName } from '../core/chromeStep'
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
  // A downloaded update installs as VoiceUp exits, unless Windows is ending the session (S7.4).
  let exitReason: ExitReason = 'quit'
  let updates: AppUpdates | null = null
  steps.update ??= () => {
    updates?.stop()
    updates?.installOnExit(exitReason)
  }

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
          if (paused) {
            listening.pause()
            log.info('Listening paused')
          } else if (listening.resume()) {
            log.info('Listening resumed')
          } else {
            log.warn('HOTKEY_TAKEN: the hotkey could not be had back after a pause')
            reportHotkeyTaken(terminalWindow, store.current.hotkey)
          }
          setListeningPaused(listening.isPaused)
          settingsScreen.refresh()
        },
        restartToUpdate: () => {
          exitReason = 'restart'
          app.quit()
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
      // The first check waits 30 s, so it never competes with Claude starting.
      startUpdates(updateReady)
        .then((started) => {
          updates = started
        })
        .catch((error: unknown) => {
          log.error('App updates could not start; this copy will not update', error)
        })
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

      // Step 6: Claude itself starts at the renderer's first size, so it never draws at a wrong one.
      const claude = new ClaudeSession({
        window: mainWindow,
        settings: store,
        resolveCommand: () => resolveClaude(app.isPackaged),
        readVersion: readClaudeVersion,
        hooks: {
          prepareLaunch: (cwd) => hooks.prepareLaunch(cwd),
          launched: () => {
            delivery.sessionRestarted()
            claudeState.sessionRestart()
            hooks.launched()
            publishStatus()
          },
          exited: () => {
            delivery.sessionEnded()
            claudeState.ptyExit()
            hooks.exited()
          }
        }
      })
      registerTerminalIpc(claude.host, (data) => {
        claudeState.onInput(data)
        // Ctrl+C can clear the prompt with no change of state, which may free the queue.
        delivery.kick()
      })
      steps.pty ??= () => claude.host.stop()
      registerTerminalUiIpc(mainWindow, () => claude.fontSize)
      let microphones: readonly MicDevice[] = []
      const rebuildMenu = (): void => {
        // Electron applies this to every window, which would undo the wizard's removeMenu and offer
        // Change folder, which starts Claude. Rebuilt when the wizard finishes.
        // Checked by the saved state, not the window: the wizard can change the menu while it is still
        // opening, as a download it resumes reports progress.
        if (!store.current.wizard.done) return
        installAppMenu({
          changeFolder: () => claude.changeFolder(),
          changeFontSize: (change) => {
            claude.changeFontSize(change)
          },
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
      // Closing the terminal hides it in the tray once set up (S7.1), and Claude keeps running.
      // Quit, signing out and shutting down still quit. During setup, closing still quits.
      let quitting = false
      let toldStillRunning = false
      app.on('before-quit', () => {
        quitting = true
      })
      const endingSession = (): void => {
        quitting = true
        exitReason = 'sessionEnd'
      }
      terminalWindow.on('query-session-end', endingSession)
      terminalWindow.on('session-end', endingSession)
      terminalWindow.on('close', (event) => {
        if (quitting || !store.current.wizard.done) return
        event.preventDefault()
        terminalWindow.hide()
        log.info('Window hidden in the tray')
        if (!toldStillRunning) {
          toldStillRunning = true
          stillRunning()
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
      const listening = new Listening({
        register: (accelerator) => {
          steps.shortcuts ??= unregisterHotkeys
          return registerHotkey(accelerator, () => {
            recording.press()
          })
        },
        unregister: unregisterHotkey,
        hotkey: () => store.current.hotkey,
        cancelRecording: () => {
          recording.cancel()
        }
      })
      // Once only: the wizard's microphone test may have turned it on already.
      const startHotkey = (): boolean => listening.start()
      const changeHotkey = (next: string): boolean => {
        if (listening.change(next)) {
          log.info('Hotkey changed')
          return true
        }
        log.warn('HOTKEY_TAKEN: the new hotkey could not be registered')
        return false
      }
      const settingsScreen = new SettingsScreen({
        store,
        microphones: () => microphones,
        models: () => models.choices(),
        model: () => models.chosenStatus(),
        retryModel: () => {
          models.ensure()
        },
        changeHotkey,
        hotkeyOn: () => listening.hotkeyOn,
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
        if (!startHotkey()) reportHotkeyTaken(terminalWindow, store.current.hotkey)
      }
      if (store.current.wizard.done) {
        await openTerminal()
        return
      }
      // Windows' default browser, by name, so setup uses the one the user browses with.
      const defaultBrowser = (): ChromeBrowser | null =>
        browserFromAppName(app.getApplicationNameForProtocol('https://example.com'))
      wizard = openWizard({
        settings: store,
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
        findClaude: () => resolveClaude(app.isPackaged),
        readClaudeVersion,
        runInstaller: (onOutput) => runInstaller(installScript(app.isPackaged), onOutput),
        chooseFolder: pickProjectFolder,
        isFolder: isDirectory,
        startClaude: (window) => {
          const { terminal, wizard: beside } = sideBySide(
            screen.getDisplayMatching(window.getBounds()).workArea
          )
          terminalWindow.setBounds(terminal)
          window.setBounds(beside)
          loadTerminal().catch(failStartup)
        },
        restartClaude: () => {
          claude.host.restart().catch((error: unknown) => {
            log.error('Could not restart Claude', error)
          })
        },
        deliver: (text) => {
          delivery.deliver(text)
        },
        discardDelivery: () => {
          delivery.discard()
        },
        promptDirty: () => claudeState.promptDirty,
        schedule,
        // Whether it is set, and never its value.
        apiKeySet: (process.env['ANTHROPIC_API_KEY'] ?? '') !== '',
        models: {
          ensure: () => {
            models.ensure()
          },
          status: () => models.status,
          chosenModel: () => models.chosenModel()
        },
        startHotkey,
        hotkey: store.current.hotkey,
        browsers: {
          find: () => findBrowsers(browserPlaces(app.isPackaged)),
          open: (browser) => {
            openStore(browser, browserPlaces(app.isPackaged))
          },
          defaultBrowser,
          openForTest: () => {
            const places = browserPlaces(app.isPackaged)
            return openForTest(browserForTest(findBrowsers(places), defaultBrowser()), places)
          }
        },
        launchedWithChrome: () => claude.launchedWithChrome
      })
      wizard.onClaudeState(claudeState.state)
      wizardWindow = wizard.window
      await loadRenderer(wizardWindow, 'wizard')
    })
    .catch(failStartup)
}
