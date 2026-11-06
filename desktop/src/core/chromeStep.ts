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
    const withExtension = this.findings.find(({ installed, extension }) => installed && extension)
    if (withExtension !== undefined) return { status: 'installed', browser: withExtension.browser }
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
