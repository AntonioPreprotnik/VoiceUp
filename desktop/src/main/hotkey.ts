import { join } from 'node:path'
import { app, dialog, globalShortcut, type BrowserWindow } from 'electron'
import { MESSAGES } from '../core/messages'
import { log } from './log'

/**
 * Registers the global hotkey and checks the result, because Electron fails silently when another
 * app owns the combination. An invalid combination throws, and counts the same way.
 */
export function registerHotkey(accelerator: string, onPress: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, onPress)
  } catch (error: unknown) {
    log.error(`Invalid hotkey ${accelerator}`, error)
    return false
  }
}

/** Security rule: nothing here comes from a renderer. Shows what happened and what to do next. */
export function reportHotkeyTaken(window: BrowserWindow, accelerator: string): void {
  log.warn(`HOTKEY_TAKEN: ${accelerator}`)
  const { title, detail } = MESSAGES.HOTKEY_TAKEN
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  dialog
    .showMessageBox(window, {
      type: 'warning',
      title: 'VoiceUp',
      message: title,
      detail: `${accelerator} is in use. ${detail}\n\n${settingsFile}`
    })
    .catch((error: unknown) => {
      log.error('Could not show the hotkey message', error)
    })
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}
