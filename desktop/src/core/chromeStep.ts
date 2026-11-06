import type { ChromeBrowser, ChromeStepStatus } from '../shared/ipcChannels'

/** What a look at one browser found, from file existence alone (S6.8). */
export interface BrowserFinding {
  readonly browser: ChromeBrowser
  readonly installed: boolean
  /** In any of its profiles. */
  readonly extension: boolean
}

/**
 * The Claude in Chrome step. The extension is required, so the step is done only when a check
 * finds it or the user says it is there, which is the way past a profile the check can't see.
 */
export class ChromeStep {
  private findings: readonly BrowserFinding[] = []
  private confirmed = false

  /** The default browser comes first when more than one has the extension. */
  constructor(private readonly defaultBrowser: ChromeBrowser | null = null) {}

  /** Returns true when the status changed. */
  update(findings: readonly BrowserFinding[]): boolean {
    const before = JSON.stringify(this.status)
    this.findings = findings
    return JSON.stringify(this.status) !== before
  }

  confirm(): void {
    this.confirmed = true
  }

  get status(): ChromeStepStatus {
    const withExtension = this.findings.filter(({ installed, extension }) => installed && extension)
    const named =
      withExtension.find(({ browser }) => browser === this.defaultBrowser) ?? withExtension.at(0)
    if (named !== undefined) return { status: 'installed', browser: named.browser }
    if (this.confirmed) return { status: 'installed', browser: null }
    const browsers = this.findings
      .filter(({ installed }) => installed)
      .map(({ browser }) => browser)
    return browsers.length === 0 ? { status: 'noBrowser' } : { status: 'needed', browsers }
  }

  get isDone(): boolean {
    return this.status.status === 'installed'
  }

  /** Only a browser the check found can open the store, so a page can't start anything else. */
  canOpen(browser: ChromeBrowser): boolean {
    return this.findings.some((finding) => finding.browser === browser && finding.installed)
  }
}

/** Which of ours the default browser is, from the name Windows gives it, such as "Brave". */
export function browserFromAppName(name: string): ChromeBrowser | null {
  if (/brave/i.test(name)) return 'brave'
  if (/chrome/i.test(name)) return 'chrome'
  return null
}

/**
 * The browser the browser test opens (S6.9): the default one if it has the extension, else one that
 * has it. With none found, the user said it's installed, so the default or any installed one.
 */
export function browserForTest(
  findings: readonly BrowserFinding[],
  defaultBrowser: ChromeBrowser | null
): ChromeBrowser | null {
  const pick = (candidates: readonly BrowserFinding[]): ChromeBrowser | null =>
    candidates.find(({ browser }) => browser === defaultBrowser)?.browser ??
    candidates.at(0)?.browser ??
    null
  const installed = findings.filter((finding) => finding.installed)
  return pick(installed.filter((finding) => finding.extension)) ?? pick(installed)
}
