import { statSync } from 'node:fs'
import { app, dialog, type BrowserWindow } from 'electron'
import type { ClaudeCommand } from '../../core/claudeCommand'
import { MESSAGES } from '../../core/messages'
import { Channels, type SessionExit } from '../../shared/ipcChannels'
import type { Settings } from '../../shared/settings'
import { log } from '../log'
import { saveSettings } from '../settings/store'
import { PtyHost } from './host'

export interface ClaudeSessionOptions {
  readonly window: BrowserWindow
  readonly settings: Settings
  /** Where settings.json lives. */
  readonly settingsDir: string
  readonly resolveCommand: () => Promise<ClaudeCommand | null>
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // Missing or unreadable: the caller logs it and asks for another folder.
    return false
  }
}

/** Claude's session in one window: which folder it runs in, and restarting it there (S1.2). */
export class ClaudeSession {
  readonly host: PtyHost
  private settings: Settings

  constructor(private readonly options: ClaudeSessionOptions) {
    this.settings = options.settings
    const { window } = options
    this.host = new PtyHost({
      send: (data) => {
        if (!window.isDestroyed()) window.webContents.send(Channels.termData, data)
      },
      onExit: (exitCode) => {
        if (window.isDestroyed()) return
        const exit: SessionExit = { ...MESSAGES.CLAUDE_EXITED, exitCode }
        window.webContents.send(Channels.sessionExited, exit)
      },
      resolveCommand: options.resolveCommand,
      resolveCwd: () => this.resolveFolder()
    })
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

  private async pickFolder(): Promise<string | null> {
    const { window } = this.options
    if (window.isDestroyed()) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Choose a project folder for Claude Code',
      defaultPath: this.settings.claude.projectDir ?? app.getPath('home'),
      properties: ['openDirectory']
    })
    return canceled ? null : (filePaths.at(0) ?? null)
  }

  private remember(folder: string): void {
    this.settings = { ...this.settings, claude: { ...this.settings.claude, projectDir: folder } }
    try {
      saveSettings(this.options.settingsDir, this.settings)
    } catch (error: unknown) {
      log.error('Could not save the project folder; it applies to this run only', error)
    }
  }
}
