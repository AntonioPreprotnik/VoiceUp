import { join } from 'node:path'
import { app, screen, session, type BrowserWindow } from 'electron'
import { sideBySide } from '../core/sideBySide'
import type { ShutdownSteps } from '../core/shutdown'
import { parseSmokeTestPath } from '../core/smokeTest'
import { RecorderDevices } from '../shared/ipc'
import { Channels, type MicDevice } from '../shared/ipcChannels'
import { installShutdown } from './appShutdown'
import { createClaudeLink } from './claudeLink'
import { registerHotkey, reportHotkeyTaken, unregisterHotkeys } from './hotkey'
import { exposeForE2e } from './e2eHook'
import { on, registerTerminalIpc } from './ipc/terminal'
import { registerTerminalUiIpc } from './ipc/terminalUi'
import { initLogging, log, setLogLevel } from './log'
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
import { SettingsStore } from './settings/settingsStore'
import { loadSettings, saveSettings } from './settings/store'
import { runSmokeTest } from './smokeTest'
import { createVoice } from './voice'
import { schedule } from './schedule'
import { openWizard, type Wizard } from './wizard'
import { createWindow, loadRenderer, windowKindOf } from './windows/factory'

function failStartup(error: unknown): void {
  log.error('Startup failed', error)
  app.exit(1)
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
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
      const terminalWindow = createWindow('terminal')
      mainWindow = terminalWindow
      const recorderWindow = createWindow('recorder', { showWhenReady: false })
      const overlayWindow = createWindow('overlay', { showWhenReady: false })
      const overlay = new Overlay({ window: overlayWindow, sounds: store.current.ui.sounds })
      loadRenderer(overlayWindow, 'overlay').catch((error: unknown) => {
        log.error('Could not load the overlay window', error)
      })
      const { claudeState, delivery, hooks, publishStatus } = createClaudeLink({
        settings: store,
        overlay,
        terminalWindow,
        parentWindow: () => mainWindow,
        showWindow: focusFront,
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
      // Step 5: the speech worker that the hidden window streams to.
      const { recording, models } = createVoice({
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
      // Loading this page is what starts Claude, and the window shows once it has loaded.
      let terminalLoad: Promise<void> | undefined
      const loadTerminal = (): Promise<void> =>
        (terminalLoad ??= loadRenderer(terminalWindow, 'terminal'))
      // Once only: the wizard's microphone test may have turned it on already.
      let hotkeyOn: boolean | undefined
      const startHotkey = (): boolean => {
        steps.shortcuts ??= unregisterHotkeys
        hotkeyOn ??= registerHotkey(store.current.hotkey, () => {
          recording.press()
        })
        return hotkeyOn
      }
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
        hotkey: store.current.hotkey
      })
      wizard.onClaudeState(claudeState.state)
      wizardWindow = wizard.window
      await loadRenderer(wizardWindow, 'wizard')
    })
    .catch(failStartup)
}
