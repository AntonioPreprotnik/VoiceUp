import { BrowserTest } from '../core/browserTest'
import { ChromeStep, type BrowserFinding } from '../core/chromeStep'
import type { ClaudeState } from '../core/state/reducer'
import type { HookMessage } from '../shared/hooks'
import type { ChromeBrowser, WizardView } from '../shared/ipcChannels'
import { log } from './log'
import type { SettingsStore } from './settings/settingsStore'

/** Chrome and Brave, for the Claude in Chrome step. */
export interface WizardBrowsers {
  /** Reads only whether files exist, never what is in them. */
  find(): readonly BrowserFinding[]
  /** Opens the fixed Web Store page in that browser. */
  open(browser: ChromeBrowser): void
  /** Windows' default browser, if it is one of ours. */
  defaultBrowser(): ChromeBrowser | null
  /** Starts the browser for the browser test if it isn't running. Opens no page. */
  openForTest(): Promise<'started' | 'running' | 'none'>
}

export interface ChromeSetupOptions {
  readonly settings: SettingsStore
  readonly browsers: WizardBrowsers
  /** Starts Claude beside the wizard unless it already runs. True if this call started it. */
  readonly startClaudeOnce: () => boolean
  readonly restartClaude: () => void
  /** Whether the running Claude was started with --chrome. */
  readonly launchedWithChrome: () => boolean
  /** Sends text to Claude through the send gate. */
  readonly deliver: (text: string) => void
  readonly discardDelivery: () => void
  readonly promptDirty: () => boolean
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly onChange: () => void
}

/**
 * The wizard's Claude in Chrome step (S6.8, S6.9): finding the extension, then a browser test that
 * Claude must pass by opening a page. The wizard decides when the step is showing.
 */
export class ChromeSetup {
  private readonly step: ChromeStep
  private readonly test: BrowserTest
  // Fixed wording only: never anything Claude wrote.
  private loggedTest = 'ready'

  constructor(private readonly options: ChromeSetupOptions) {
    this.step = new ChromeStep(options.browsers.defaultBrowser())
    this.test = new BrowserTest({
      startWithBrowser: () => this.startWithBrowser(),
      openBrowser: () => options.browsers.openForTest(),
      deliver: options.deliver,
      discard: options.discardDelivery,
      promptDirty: options.promptDirty,
      schedule: options.schedule,
      onChange: () => {
        this.logTest()
        options.onChange()
      }
    })
  }

  get view(): Pick<WizardView, 'chrome' | 'browserTest'> {
    return { chrome: this.step.status, browserTest: this.test.status }
  }

  /** The extension was found or confirmed. Finishing the step then turns browser control on. */
  get extensionReady(): boolean {
    return this.step.isDone
  }

  get canContinue(): boolean {
    return this.step.isDone && this.test.passed
  }

  /** Looks for the browsers and the extension again. True if anything changed. */
  check(): boolean {
    return this.step.update(this.options.browsers.find())
  }

  openStore(browser: ChromeBrowser): void {
    if (this.step.canOpen(browser)) this.options.browsers.open(browser)
  }

  testBrowser(): void {
    if (this.step.isDone) this.test.start()
  }

  confirm(): void {
    log.info('Setup: the user confirmed Claude in Chrome is installed')
    this.step.confirm()
  }

  onClaudeState(state: ClaudeState): void {
    this.test.onClaudeState(state)
  }

  onHook(message: HookMessage): void {
    this.test.onHook(message)
  }

  private startWithBrowser(): 'fresh' | 'running' | 'restart' {
    const { settings, startClaudeOnce, launchedWithChrome, restartClaude } = this.options
    if (!settings.current.claude.browserControl) {
      settings.update((current) => ({
        ...current,
        claude: { ...current.claude, browserControl: true }
      }))
    }
    // Sign in may have been finished in an earlier run, so Claude may not be running yet.
    if (startClaudeOnce()) return 'fresh'
    if (launchedWithChrome()) return 'running'
    restartClaude()
    return 'restart'
  }

  private logTest(): void {
    const status = this.test.status
    if (status.status === this.loggedTest) return
    this.loggedTest = status.status
    if (status.status === 'testing') log.info('Setup: browser test sent')
    else if (status.status === 'passed') log.info('Setup: browser test passed')
    else if (status.status === 'failed') log.warn(`Setup: browser test failed: ${status.title}`)
  }
}
