import type { BrowserWindow } from 'electron'
import type { FolderStepStatus } from '../shared/ipcChannels'
import { log } from './log'
import type { SettingsStore } from './settings/settingsStore'

export interface FolderStepOptions {
  readonly settings: SettingsStore
  readonly window: BrowserWindow
  /** The Windows folder picker. Null if the user cancels. */
  readonly chooseFolder: (window: BrowserWindow, current: string | null) => Promise<string | null>
  readonly isFolder: (path: string) => boolean
  /** Restarts Claude if it is running, so it moves to the new folder. */
  readonly folderChanged: () => void
  readonly onChange: () => void
}

/** The wizard's Project folder step (S6.11). */
export class FolderStep {
  private choosing = false

  constructor(private readonly options: FolderStepOptions) {}

  get status(): FolderStepStatus {
    const path = this.options.settings.current.claude.projectDir
    return { path, missing: path !== null && !this.options.isFolder(path) }
  }

  get canContinue(): boolean {
    const { path, missing } = this.status
    return path !== null && !missing
  }

  /** One picker at a time. */
  async choose(): Promise<void> {
    if (this.choosing) return
    this.choosing = true
    const { settings, window, chooseFolder, folderChanged, onChange } = this.options
    try {
      const chosen = await chooseFolder(window, settings.current.claude.projectDir)
      if (chosen === null) return
      settings.update((current) => ({
        ...current,
        claude: { ...current.claude, projectDir: chosen }
      }))
      // Claude runs in one folder for its whole session, so going back to change it restarts it.
      folderChanged()
      onChange()
    } catch (error: unknown) {
      log.error('Could not ask for a project folder', error)
    } finally {
      this.choosing = false
    }
  }
}
