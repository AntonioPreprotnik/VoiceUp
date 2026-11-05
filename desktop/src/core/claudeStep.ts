import type { ClaudeCommand } from './claudeCommand'
import { INSTALL_COMMAND, isTooOld, MIN_CLAUDE_VERSION, UPDATE_COMMAND } from './claudeVersion'
import type { ClaudeStepStatus } from '../shared/ipcChannels'

export interface ClaudeStepDeps {
  /** Looks again each time, because an install changes the answer. */
  readonly find: () => Promise<ClaudeCommand | null>
  readonly readVersion: (command: ClaudeCommand) => Promise<string | null>
  /** Runs the official installer. Resolves when it ends, whatever the result. */
  readonly install: () => Promise<void>
  readonly onChange: () => void
  readonly onError: (error: unknown) => void
}

/** The wizard's Claude Code step: find it, install it on request, and check the version. */
export class ClaudeStep {
  private current: ClaudeStepStatus = { status: 'checking' }
  private busy = false

  constructor(private readonly deps: ClaudeStepDeps) {}

  get status(): ClaudeStepStatus {
    return this.current
  }

  get canContinue(): boolean {
    return this.current.status === 'ready'
  }

  async check(): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.show({ status: 'checking' })
    try {
      this.show(await this.look())
    } catch (error: unknown) {
      this.deps.onError(error)
      this.show({ status: 'failed', command: INSTALL_COMMAND })
    } finally {
      this.busy = false
    }
  }

  /** Only when Claude is known to be missing: the user's click on Install is the consent. */
  async install(): Promise<void> {
    const { status } = this.current
    if (this.busy || (status !== 'missing' && status !== 'failed')) return
    this.busy = true
    this.show({ status: 'installing' })
    try {
      await this.deps.install()
      const found = await this.look()
      this.show(found.status === 'missing' ? { status: 'failed', command: INSTALL_COMMAND } : found)
    } catch (error: unknown) {
      this.deps.onError(error)
      this.show({ status: 'failed', command: INSTALL_COMMAND })
    } finally {
      this.busy = false
    }
  }

  private async look(): Promise<ClaudeStepStatus> {
    const command = await this.deps.find()
    if (command === null) return { status: 'missing', command: INSTALL_COMMAND }
    const version = await this.deps.readVersion(command)
    if (version !== null && isTooOld(version)) {
      return { status: 'tooOld', version, minimum: MIN_CLAUDE_VERSION, command: UPDATE_COMMAND }
    }
    return { status: 'ready', version }
  }

  private show(status: ClaudeStepStatus): void {
    this.current = status
    this.deps.onChange()
  }
}
