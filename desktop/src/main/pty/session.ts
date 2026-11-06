import type { BrowserWindow } from 'electron'
import type { ClaudeCommand } from '../../core/claudeCommand'
import { adjustFontSize, type FontSizeChange } from '../../core/fontSize'
import { MESSAGES } from '../../core/messages'
import { Channels, type SessionExit } from '../../shared/ipcChannels'
import { log } from '../log'
import type { ModelId } from '../../shared/models'
import type { Settings } from '../../shared/settings'
import type { LaunchExtras } from '../hooks/link'
import type { SettingsStore } from '../settings/settingsStore'
import { PtyHost } from './host'
import { isDirectory, pickProjectFolder } from './projectFolder'

export interface ClaudeSessionOptions {
  readonly window: BrowserWindow
  readonly settings: SettingsStore
  readonly resolveCommand: () => Promise<ClaudeCommand | null>
  readonly readVersion: (command: ClaudeCommand) => Promise<string | null>
  readonly hooks: {
    prepareLaunch(cwd: string): Promise<LaunchExtras>
    launched(): void
    exited(): void
  }
}

/** Claude's session in one window: which folder it runs in, and restarting it there (S1.2). */
export class ClaudeSession {
  readonly host: PtyHost
  private chrome = false

  constructor(private readonly options: ClaudeSessionOptions) {
    const { window, hooks } = options
    this.host = new PtyHost({
      send: (data) => {
        if (!window.isDestroyed()) window.webContents.send(Channels.termData, data)
      },
      prepareLaunch: async (cwd) => {
        const extras = await hooks.prepareLaunch(cwd)
        // Read at each launch: the setting applies from the next start (S6.9).
        this.chrome = this.settings.claude.browserControl
        return { ...extras, args: [...extras.args, ...(this.chrome ? ['--chrome'] : [])] }
      },
      onLaunched: () => {
        hooks.launched()
      },
      onExit: (exitCode) => {
        hooks.exited()
        this.report({ ...MESSAGES.CLAUDE_EXITED, command: null, exitCode })
      },
      onNotFound: () => {
        this.report({ ...MESSAGES.CLAUDE_NOT_FOUND, exitCode: null })
      },
      onTooOld: () => {
        this.report({ ...MESSAGES.CLAUDE_TOO_OLD, exitCode: null })
      },
      resolveCommand: options.resolveCommand,
      readVersion: options.readVersion,
      resolveCwd: () => this.resolveFolder()
    })
  }

  private report(exit: SessionExit): void {
    const { window } = this.options
    if (!window.isDestroyed()) window.webContents.send(Channels.sessionExited, exit)
  }

  /** Whether the running Claude was started with --chrome. */
  get launchedWithChrome(): boolean {
    return this.chrome
  }

  get fontSize(): number {
    return this.settings.ui.fontSize
  }

  get micDeviceId(): string | null {
    return this.settings.micDeviceId
  }

  setModel(modelId: ModelId): void {
    this.save({ ...this.settings, speech: { ...this.settings.speech, modelId } })
  }

  /** Null is the system default. Applies from the next recording. */
  setMicDevice(micDeviceId: string | null): void {
    this.save({ ...this.settings, micDeviceId })
  }

  changeFontSize(change: FontSizeChange): void {
    const fontSize = adjustFontSize(this.settings.ui.fontSize, change)
    if (fontSize === this.settings.ui.fontSize) return
    this.save({ ...this.settings, ui: { ...this.settings.ui, fontSize } })
    const { window } = this.options
    if (!window.isDestroyed()) window.webContents.send(Channels.termFontSize, fontSize)
  }

  /** Asks for a folder and restarts Claude there. Cancelling leaves the session running. */
  async changeFolder(): Promise<void> {
    const folder = await this.pickFolder()
    if (folder === null) return
    this.remember(folder)
    await this.host.restart()
  }

  /** The remembered folder, or the user's choice if there is none. Null if they cancel. */
  private async resolveFolder(): Promise<string | null> {
    const saved = this.settings.claude.projectDir
    if (saved !== null) {
      if (isDirectory(saved)) return saved
      log.warn('The saved project folder no longer exists; asking for another')
    }
    await this.windowVisible()
    const folder = await this.pickFolder()
    if (folder !== null) this.remember(folder)
    return folder
  }

  /** A dialog parented to a window that is still hidden could open out of sight. */
  private windowVisible(): Promise<void> {
    const { window } = this.options
    if (window.isVisible()) return Promise.resolve()
    return new Promise((resolve) => {
      window.once('show', resolve)
      window.once('closed', resolve)
    })
  }

  private pickFolder(): Promise<string | null> {
    return pickProjectFolder(this.options.window, this.settings.claude.projectDir)
  }

  private remember(folder: string): void {
    this.save({ ...this.settings, claude: { ...this.settings.claude, projectDir: folder } })
  }

  private get settings(): Settings {
    return this.options.settings.current
  }

  private save(settings: Settings): void {
    this.options.settings.update(() => settings)
  }
}
