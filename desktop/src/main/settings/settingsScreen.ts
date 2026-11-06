import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  defaultEditable,
  editable,
  fieldError,
  shownMicrophone,
  withChanges
} from '../../core/settingsEdit'
import { NoPayload, SettingsChange } from '../../shared/ipc'
import {
  Channels,
  type MicDevice,
  type ModelStepStatus,
  type SettingsResult,
  type SettingsView
} from '../../shared/ipcChannels'
import { Settings } from '../../shared/settings'
import type { EditableSettings, SettingsField } from '../../shared/settingsFields'
import { SENDERS } from '../ipc/allowlist'
import { validateSender } from '../ipc/validateSender'
import { log } from '../log'
import type { SettingsStore } from './settingsStore'
import { createWindow, loadRenderer } from '../windows/factory'

export interface SettingsScreenOptions {
  readonly store: SettingsStore
  readonly microphones: () => readonly MicDevice[]
  readonly models: () => SettingsView['models']
  /** The chosen model's download, as the wizard shows it. */
  readonly model: () => ModelStepStatus
  readonly retryModel: () => void
  /** Turns the new hotkey on and the old one off. False, with the old one kept, if it can't. */
  readonly changeHotkey: (accelerator: string) => boolean
  readonly hotkeyOn: () => boolean
  /** Only a packaged build can add itself to the startup list. */
  readonly canStartWithWindows: boolean
}

const HOTKEY_REFUSED =
  'Another app uses it, or Windows doesn’t allow it, so the old hotkey is still on.'

/**
 * The settings window and its channels. The page sends only the fields it shows, and main checks
 * every change against the schema before saving it (TECH_SPEC §6.1, §6.4).
 */
export class SettingsScreen {
  private window: BrowserWindow | undefined

  constructor(private readonly options: SettingsScreenOptions) {
    const handle = (channel: SettingsChannel, act: (raw: unknown) => SettingsResult): void => {
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown): SettingsResult => {
        if (!validateSender(event, ...SENDERS[channel])) return refused()
        return act(raw)
      })
    }
    const empty =
      (act: () => SettingsResult) =>
      (raw: unknown): SettingsResult =>
        NoPayload.safeParse(raw).success ? act() : refused()
    handle(
      Channels.settingsGet,
      empty(() => ({ ok: true, data: this.view() }))
    )
    handle(Channels.settingsSet, (raw) => {
      const parsed = SettingsChange.safeParse(raw)
      if (!parsed.success) {
        log.warn(`Dropped an invalid IPC payload on ${Channels.settingsSet}`)
        return refused()
      }
      return this.apply(parsed.data)
    })
    handle(
      Channels.settingsReset,
      empty(() => {
        log.info('Settings reset to defaults')
        return this.apply(defaultEditable())
      })
    )
    handle(
      Channels.settingsRetryModel,
      empty(() => {
        this.options.retryModel()
        return { ok: true, data: this.view() }
      })
    )
    options.store.subscribe(() => {
      this.refresh()
    })
  }

  /** Brings the window up, opening it if needed. */
  open(): void {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore()
      this.window.focus()
      return
    }
    const window = createWindow('settings')
    window.removeMenu()
    window.once('closed', () => {
      this.window = undefined
    })
    this.window = window
    loadRenderer(window, 'settings').catch((error: unknown) => {
      log.error('Could not load the settings window', error)
    })
  }

  /** Something the page shows changed outside it, such as a download or a microphone. */
  refresh(): void {
    const { window } = this
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send(Channels.settingsChanged, this.view())
    }
  }

  private view(): SettingsView {
    const { store, microphones, models, model, hotkeyOn, canStartWithWindows } = this.options
    const values = editable(store.current)
    return {
      values: { ...values, micDeviceId: shownMicrophone(values.micDeviceId, microphones()) },
      microphones: microphones(),
      models: models(),
      model: model(),
      hotkeyOn: hotkeyOn(),
      canStartWithWindows
    }
  }

  private apply(changes: Partial<EditableSettings>): SettingsResult {
    const { store, changeHotkey } = this.options
    const { hotkey, ...rest } = changes
    const next = withChanges(store.current, rest)
    const parsed = Settings.safeParse(next)
    if (!parsed.success) {
      const errors: Partial<Record<SettingsField, string>> = {}
      for (const issue of parsed.error.issues) {
        const { field, message } = fieldError(issue.path)
        errors[field] = message
      }
      // Only the field names: the values may be anything the page sent.
      log.warn(`Refused a settings change: ${Object.keys(errors).join(', ')}`)
      return { ok: false, errors, data: this.view() }
    }
    const errors: Partial<Record<SettingsField, string>> = {}
    let finalHotkey = store.current.hotkey
    if (hotkey !== undefined && hotkey !== store.current.hotkey) {
      if (changeHotkey(hotkey)) finalHotkey = hotkey
      else errors.hotkey = HOTKEY_REFUSED
    }
    store.update(() => withChanges(parsed.data, { hotkey: finalHotkey }))
    return Object.keys(errors).length === 0
      ? { ok: true, data: this.view() }
      : { ok: false, errors, data: this.view() }
  }
}

type SettingsChannel =
  | typeof Channels.settingsGet
  | typeof Channels.settingsSet
  | typeof Channels.settingsReset
  | typeof Channels.settingsRetryModel

function refused(): SettingsResult {
  return { ok: false, errors: {}, data: null }
}
