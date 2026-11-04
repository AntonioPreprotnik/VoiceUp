import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildHookSettings, hooksBlockedBy, type HookPolicies } from '../../core/hookConfig'
import type { MessageCode } from '../../core/messages'
import type { HookMessage } from '../../shared/hooks'
import { log } from '../log'
import { HookServer } from './server'

const STARTING_SLOW_MS = 30000
const STALE_FILE = /^(?:hooks-\d+\.json|hook-header-\d+\.txt)$/

export interface LaunchExtras {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export interface HookLinkOptions {
  /** userData/run. Holds nothing but this link's files. */
  readonly runDir: string
  readonly curlPath: string
  readonly readPolicies: (projectDir: string) => HookPolicies
  readonly onMessage: (message: HookMessage) => void
  /** Hooks can't run for this launch, so voice is off. */
  readonly onUnavailable: (code: 'HOOKS_BLOCKED' | 'HOOKS_FAILED', setting: string | null) => void
  /** Non-blocking: a trust prompt or a login can legitimately take longer. */
  readonly onStartingSlow: () => void
}

/** Connects a Claude launch to the hook server, through per-launch files only (TECH_SPEC §4.2). */
export class HookLink {
  private readonly server: HookServer
  private readonly ready: Promise<number | null>
  private readonly settingsFile: string
  private readonly headerFile: string
  private slowTimer: ReturnType<typeof setTimeout> | undefined
  private unavailable: MessageCode | null = null

  constructor(private readonly options: HookLinkOptions) {
    this.settingsFile = join(options.runDir, `hooks-${String(process.pid)}.json`)
    this.headerFile = join(options.runDir, `hook-header-${String(process.pid)}.txt`)
    this.server = new HookServer({
      onMessage: (message) => {
        if (message.kind === 'hook' && message.hook.hook_event_name === 'SessionStart') {
          this.clearSlowTimer()
        }
        options.onMessage(message)
      }
    })
    this.ready = this.prepare()
  }

  /** Why voice is off, or null. Read at each press. */
  get voiceBlock(): MessageCode | null {
    return this.unavailable
  }

  /** Files from a crashed run go first, and a failure here must not stop Claude from starting. */
  private async prepare(): Promise<number | null> {
    try {
      this.removeStaleFiles()
      const port = await this.server.start()
      const { curlPath } = this.options
      const settings = buildHookSettings({ port, curlPath, headerFile: this.headerFile })
      writeFileSync(this.headerFile, `X-VoiceUp-Token: ${this.server.token}\n`)
      writeFileSync(this.settingsFile, JSON.stringify(settings))
      return port
    } catch (error: unknown) {
      log.error('HOOKS_FAILED: could not start the hook server', error)
      return null
    }
  }

  private removeStaleFiles(): void {
    const { runDir } = this.options
    mkdirSync(runDir, { recursive: true })
    for (const name of readdirSync(runDir)) {
      if (STALE_FILE.test(name)) rmSync(join(runDir, name), { force: true })
    }
  }

  /** Read at each launch, since the folder can change. With hooks stopped, none are passed:
   * Claude would print a hook error on its own screen for every one. */
  async prepareLaunch(projectDir: string): Promise<LaunchExtras> {
    const port = await this.ready
    if (port === null) {
      this.unavailable = 'HOOKS_FAILED'
      this.options.onUnavailable('HOOKS_FAILED', null)
      return { args: [], env: {} }
    }
    const setting = hooksBlockedBy(this.options.readPolicies(projectDir), port)
    if (setting !== null) {
      log.warn(`HOOKS_BLOCKED by ${setting}`)
      this.unavailable = 'HOOKS_BLOCKED'
      this.options.onUnavailable('HOOKS_BLOCKED', setting)
      return { args: [], env: {} }
    }
    this.unavailable = null
    return {
      args: ['--settings', this.settingsFile],
      env: { VOICEUP_HOOK_TOKEN: this.server.token }
    }
  }

  launched(): void {
    this.clearSlowTimer()
    if (this.unavailable !== null) return
    this.slowTimer = setTimeout(() => {
      log.warn('STARTING_SLOW: no SessionStart after 30 s')
      this.options.onStartingSlow()
    }, STARTING_SLOW_MS)
  }

  exited(): void {
    this.clearSlowTimer()
  }

  private clearSlowTimer(): void {
    clearTimeout(this.slowTimer)
    this.slowTimer = undefined
  }

  async stopServer(): Promise<void> {
    this.clearSlowTimer()
    await this.ready
    await this.server.stop()
  }

  removeFiles(): void {
    for (const file of [this.settingsFile, this.headerFile]) rmSync(file, { force: true })
  }
}
