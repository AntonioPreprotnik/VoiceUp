import { clipboard, ipcMain, Menu, shell, type BrowserWindow } from 'electron'
import { isAllowedLink } from '../../core/linkPolicy'
import { ClipboardWrite, ContextMenuRequest, LinkOpen } from '../../shared/ipc'
import { Channels, type TerminalMenuAction } from '../../shared/ipcChannels'
import { log } from '../log'
import { SENDERS } from './allowlist'
import { on } from './terminal'
import { validateSender } from './validateSender'

function openLink(url: string): void {
  // Security rule 5. The address is left out of the log, because it can carry private data.
  if (!isAllowedLink(url)) {
    log.warn('Blocked a link that is not https:')
    return
  }
  shell.openExternal(url).catch((error: unknown) => {
    log.error('Could not open a link', error)
  })
}

function showContextMenu(window: BrowserWindow, hasSelection: boolean): void {
  const send = (action: TerminalMenuAction): void => {
    if (!window.isDestroyed()) window.webContents.send(Channels.termMenuAction, action)
  }
  Menu.buildFromTemplate([
    {
      label: 'Copy',
      accelerator: 'Ctrl+Shift+C',
      registerAccelerator: false,
      enabled: hasSelection,
      click: () => {
        send('copy')
      }
    },
    {
      label: 'Paste',
      accelerator: 'Ctrl+Shift+V',
      registerAccelerator: false,
      click: () => {
        send('paste')
      }
    }
  ]).popup({ window })
}

/** Clipboard, links, right-click menu and font size: what the sandboxed page can't do itself. */
export function registerTerminalUiIpc(window: BrowserWindow, getFontSize: () => number): void {
  on(Channels.clipboardWrite, ClipboardWrite, (text) => {
    clipboard.writeText(text).catch((error: unknown) => {
      log.error('Could not write to the clipboard', error)
    })
  })
  on(Channels.linkOpen, LinkOpen, ({ url }) => {
    openLink(url)
  })
  on(Channels.termContextMenu, ContextMenuRequest, ({ hasSelection }) => {
    showContextMenu(window, hasSelection)
  })

  // Security rule 8. A rejected sender gets nothing back, not an error it could learn from.
  ipcMain.handle(Channels.clipboardRead, (event) =>
    validateSender(event, ...SENDERS[Channels.clipboardRead]) ? clipboard.readText() : ''
  )
  ipcMain.handle(Channels.settingsFontSize, (event) =>
    validateSender(event, ...SENDERS[Channels.settingsFontSize]) ? getFontSize() : null
  )
}
