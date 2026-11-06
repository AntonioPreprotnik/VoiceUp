import type { BrowserWindow } from 'electron'
import type { ClaudeCommand } from '../core/claudeCommand'
import { BrowserTest } from '../core/browserTest'
import { ChromeStep, type BrowserFinding } from '../core/chromeStep'
import { ClaudeStep } from '../core/claudeStep'
import { MESSAGES, type MessageCode } from '../core/messages'
import { formatSize } from '../core/modelChoice'
import { SignInStep } from '../core/signInStep'
import type { ClaudeState } from '../core/state/reducer'
import { WizardFlow } from '../core/wizardFlow'
import type { HookMessage } from '../shared/hooks'
import {
  Channels,
  type ChromeBrowser,
  type FolderStepStatus,
  type MicStepStatus,
  type ModelStepStatus,
  type WizardView
} from '../shared/ipcChannels'
import { registerWizardIpc } from './ipc/wizard'
import { log } from './log'
import type { ModelStatus } from './models/controller'
import type { RunningInstall } from './pty/installClaude'
import type { SettingsStore } from './settings/settingsStore'
import { createWindow } from './windows/factory'

export interface WizardOptions {
  readonly settings: SettingsStore
  readonly onFinished: () => void
  /** The user closed the window before finishing. */
  readonly onAbandoned: () => void
  readonly findClaude: () => Promise<ClaudeCommand | null>
  readonly readClaudeVersion: (command: ClaudeCommand) => Promise<string | null>
  readonly runInstaller: (onOutput: (text: string) => void) => RunningInstall
  /** The Windows folder picker. Null if the user cancels. */
  readonly chooseFolder: (window: BrowserWindow, current: string | null) => Promise<string | null>
  readonly isFolder: (path: string) => boolean
  /** Starts Claude in the terminal beside this window. Called once, on reaching Sign in. */
  readonly startClaude: (window: BrowserWindow) => void
  readonly restartClaude: () => void
  /** Sends text to Claude through the send gate. */
  readonly deliver: (text: string) => void
  readonly discardDelivery: () => void
  readonly promptDirty: () => boolean
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly apiKeySet: boolean
  readonly models: {
    /** Starts the download if the model isn't on disk. */
    ensure(): void
    status(): ModelStatus
    chosenModel(): { label: string; bytes: number; installed: boolean }
  }
  /** Turns the global hotkey on, once. False if another app has it. */
  readonly startHotkey: () => boolean
  /** As Electron names it, such as Control+Shift+Space. */
  readonly hotkey: string
  /** Chrome and Brave, for the Claude in Chrome step. */
  readonly browsers: {
    /** Reads only whether files exist, never what is in them. */
    find(): readonly BrowserFinding[]
    /** Opens the fixed Web Store page in that browser. */
    open(browser: ChromeBrowser): void
    /** Windows' default browser, if it is one of ours. */
    defaultBrowser(): ChromeBrowser | null
    /** Starts the browser for the browser test if it isn't running. Opens no page. */
    openForTest(): Promise<'started' | 'running' | 'none'>
  }
  /** Whether the running Claude was started with --chrome. */
  readonly launchedWithChrome: () => boolean
}

export interface Wizard {
  readonly window: BrowserWindow
  onClaudeState(state: ClaudeState): void
  onHook(message: HookMessage): void
  onModelStatus(): void
  /** What the microphone test heard. Shown on the page, never sent and never logged. */
  onTranscript(text: string): void
  onVoiceFailed(code: MessageCode): void
}

/** Opens the first-run wizard, with its progress saved after each step. The caller loads the page. */
export function openWizard({
  settings,
  onFinished,
  onAbandoned,
  findClaude,
  readClaudeVersion,
  runInstaller,
  chooseFolder,
  isFolder,
  startClaude,
  restartClaude,
  deliver,
  discardDelivery,
  promptDirty,
  schedule,
  apiKeySet,
  models,
  startHotkey,
  hotkey,
  browsers,
  launchedWithChrome
}: WizardOptions): Wizard {
  const flow = new WizardFlow(settings.current.wizard.completed)
  const window = createWindow('wizard')
  // The app menu acts on a session and the speech model, which wait until the wizard is finished.
  // The caller must also not reinstall it while this is open: Electron would put it back here.
  window.removeMenu()

  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  let installing: RunningInstall | undefined
  const claudeStep = new ClaudeStep({
    find: findClaude,
    readVersion: readClaudeVersion,
    install: async () => {
      installing = runInstaller((text) => {
        send(Channels.wizardOutput, text)
      })
      await installing.done
      installing = undefined
    },
    onChange: () => {
      send(Channels.wizardChanged, view())
    },
    onError: (error) => {
      log.error('The Claude Code step failed', error)
    }
  })

  const signIn = new SignInStep({
    deliver,
    discard: discardDelivery,
    promptDirty,
    schedule,
    onChange: () => {
      send(Channels.wizardChanged, view())
    }
  })

  const chromeStep = new ChromeStep(browsers.defaultBrowser())
  const checkChrome = (): boolean => chromeStep.update(browsers.find())

  let claudeStarted = false
  const browserTest = new BrowserTest({
    startWithBrowser: () => {
      if (!settings.current.claude.browserControl) {
        settings.update((current) => ({
          ...current,
          claude: { ...current.claude, browserControl: true }
        }))
      }
      // Sign in may have been finished in an earlier run, so Claude may not be running yet.
      if (!claudeStarted) {
        claudeStarted = true
        startClaude(window)
        return 'fresh'
      }
      if (launchedWithChrome()) return 'running'
      restartClaude()
      return 'restart'
    },
    openBrowser: () => browsers.openForTest(),
    deliver,
    discard: discardDelivery,
    promptDirty,
    schedule,
    onChange: () => {
      logBrowserTest()
      send(Channels.wizardChanged, view())
    }
  })
  // Fixed wording only: never anything Claude wrote.
  let loggedTest = 'ready'
  const logBrowserTest = (): void => {
    const status = browserTest.status
    if (status.status === loggedTest) return
    loggedTest = status.status
    if (status.status === 'testing') log.info('Setup: browser test sent')
    else if (status.status === 'passed') log.info('Setup: browser test passed')
    else if (status.status === 'failed') log.warn(`Setup: browser test failed: ${status.title}`)
  }
  let hotkeyOn: boolean | null = null
  let heard: string | null = null
  let micProblem: MicStepStatus['problem'] = null
  let micSkipped = false
  const enteredStep = (): void => {
    const step = flow.currentStep
    const done = flow.completed.includes(step)
    if (step === 'signIn' && !claudeStarted && !done) {
      claudeStarted = true
      startClaude(window)
    }
    if (step === 'speechModel' && !done) models.ensure()
    if (step === 'micAndHotkey' && hotkeyOn === null) hotkeyOn = startHotkey()
    if (step === 'claudeInChrome') checkChrome()
  }

  const model = (): ModelStepStatus => {
    const chosen = models.chosenModel()
    const status = models.status()
    const phase: ModelStepStatus['phase'] = chosen.installed
      ? 'ready'
      : status.phase === 'installing'
        ? status.stage
        : status.phase === 'failed'
          ? 'failed'
          : 'waiting'
    return {
      label: chosen.label,
      size: formatSize(chosen.bytes),
      phase,
      percent: status.phase === 'installing' ? status.percent : 0
    }
  }

  const mic = (): MicStepStatus => ({
    hotkey: hotkey.replaceAll('Control', 'Ctrl'),
    hotkeyOn,
    heard,
    problem: micProblem,
    skipped: micSkipped
  })

  const folder = (): FolderStepStatus => {
    const path = settings.current.claude.projectDir
    return { path, missing: path !== null && !isFolder(path) }
  }

  const canContinue = (): boolean => {
    if (flow.currentStep === 'claudeCode') return claudeStep.canContinue
    if (flow.currentStep === 'projectFolder') {
      const { path, missing } = folder()
      return path !== null && !missing
    }
    if (flow.completed.includes(flow.currentStep)) return true
    if (flow.currentStep === 'signIn') return signIn.isDone
    if (flow.currentStep === 'speechModel') return models.chosenModel().installed
    if (flow.currentStep === 'micAndHotkey') return heard !== null || micSkipped
    if (flow.currentStep === 'claudeInChrome') return chromeStep.isDone && browserTest.passed
    return true
  }
  const view = (): WizardView => ({
    ...flow.view,
    claude: claudeStep.status,
    chrome: chromeStep.status,
    browserTest: browserTest.status,
    folder: folder(),
    signIn: signIn.status,
    model: model(),
    mic: mic(),
    apiKeyWarning: apiKeySet ? MESSAGES.API_KEY_SET : null,
    canContinue: canContinue()
  })

  /** One save per step. browserControl is what S6.9 launches Claude with. */
  const persist = (turnOnBrowserControl = false): void => {
    settings.update((current) => ({
      ...current,
      ...(turnOnBrowserControl ? { claude: { ...current.claude, browserControl: true } } : {}),
      wizard: { done: flow.finished, completed: [...flow.completed] }
    }))
  }

  let choosing = false
  const chooseProjectFolder = async (): Promise<void> => {
    if (choosing) return
    choosing = true
    try {
      const chosen = await chooseFolder(window, settings.current.claude.projectDir)
      if (chosen === null) return
      settings.update((current) => ({
        ...current,
        claude: { ...current.claude, projectDir: chosen }
      }))
      // Claude runs in one folder for its whole session, so going back to change it restarts it.
      if (claudeStarted) restartClaude()
      send(Channels.wizardChanged, view())
    } catch (error: unknown) {
      log.error('Could not ask for a project folder', error)
    } finally {
      choosing = false
    }
  }

  registerWizardIpc({
    view,
    back: () => {
      flow.back()
      enteredStep()
      return view()
    },
    next: () => {
      // Main decides, so a page that enabled its own button still can't skip the check.
      if (flow.finished || !canContinue()) return view()
      // Only this step, finished with the extension, turns browser control on.
      const chromeDone = flow.currentStep === 'claudeInChrome' && chromeStep.isDone
      const finishedNow = flow.next()
      persist(chromeDone)
      if (finishedNow) {
        log.info('Setup finished')
        onFinished()
        window.close()
      } else {
        enteredStep()
      }
      return view()
    },
    checkClaude: () => {
      void claudeStep.check()
      return view()
    },
    installClaude: () => {
      void claudeStep.install()
      return view()
    },
    chooseFolder: () => {
      void chooseProjectFolder()
      return view()
    },
    testClaude: () => {
      signIn.test()
      return view()
    },
    restartClaude: () => {
      if (claudeStarted) restartClaude()
      return view()
    },
    retryModel: () => {
      if (flow.currentStep === 'speechModel') models.ensure()
      return view()
    },
    skipMicTest: () => {
      if (flow.currentStep === 'micAndHotkey') {
        log.info('Setup: microphone test skipped')
        micSkipped = true
      }
      return view()
    },
    openChromeStore: (browser) => {
      if (flow.currentStep === 'claudeInChrome' && chromeStep.canOpen(browser))
        browsers.open(browser)
      return view()
    },
    checkChrome: () => {
      if (flow.currentStep === 'claudeInChrome') checkChrome()
      return view()
    },
    testBrowser: () => {
      if (flow.currentStep === 'claudeInChrome' && chromeStep.isDone) browserTest.start()
      return view()
    },
    confirmChrome: () => {
      if (flow.currentStep === 'claudeInChrome') {
        log.info('Setup: the user confirmed Claude in Chrome is installed')
        chromeStep.confirm()
      }
      return view()
    }
  })

  // Coming back from the browser is when the extension has just been added.
  window.on('focus', () => {
    if (!flow.finished && flow.currentStep === 'claudeInChrome' && checkChrome()) {
      send(Channels.wizardChanged, view())
    }
  })
  window.once('closed', () => {
    installing?.stop()
    if (!flow.finished) onAbandoned()
  })
  void claudeStep.check()
  enteredStep()
  return {
    window,
    onClaudeState: (state) => {
      signIn.onClaudeState(state)
      browserTest.onClaudeState(state)
    },
    onHook: (message) => {
      signIn.onHook(message)
      browserTest.onHook(message)
    },
    onModelStatus: () => {
      send(Channels.wizardChanged, view())
    },
    onTranscript: (text) => {
      heard = text
      micProblem = null
      send(Channels.wizardChanged, view())
    },
    onVoiceFailed: (code) => {
      micProblem = { title: MESSAGES[code].title, detail: MESSAGES[code].detail }
      send(Channels.wizardChanged, view())
    }
  }
}
