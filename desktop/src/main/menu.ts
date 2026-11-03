import { mkdir } from 'node:fs/promises'
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { FontSizeChange } from '../core/fontSize'
import type { MicDevice } from '../shared/ipcChannels'
import { log, logsDirectory } from './log'

async function openLogsFolder(): Promise<void> {
  const directory = logsDirectory()
  await mkdir(directory, { recursive: true })
  const failure = await shell.openPath(directory)
  if (failure !== '') log.error(`Could not open the logs folder ${directory}: ${failure}`)
}

/** What the menu can do to a running session. */
export interface SessionMenuActions {
  readonly changeFolder: () => Promise<void>
  readonly changeFontSize: (change: FontSizeChange) => void
  readonly microphones: readonly MicDevice[]
  readonly selectedMicrophone: string | null
  /** Null is the system default. */
  readonly selectMicrophone: (deviceId: string | null) => void
}

function microphoneMenu(actions: SessionMenuActions): MenuItemConstructorOptions {
  const { microphones, selectedMicrophone, selectMicrophone } = actions
  // A saved microphone that isn't plugged in now shows as the system default, which is what
  // getUserMedia falls back to.
  const selected = microphones.some(({ deviceId }) => deviceId === selectedMicrophone)
    ? selectedMicrophone
    : null
  const item = (label: string, deviceId: string | null): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: deviceId === selected,
    click: () => {
      selectMicrophone(deviceId)
    }
  })
  return {
    label: 'Microphone',
    submenu: [
      item('System default', null),
      ...microphones.map(({ deviceId, label }) => item(label, deviceId))
    ]
  }
}

function fontSizeItem(
  actions: SessionMenuActions,
  label: string,
  accelerator: string,
  change: FontSizeChange
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => {
      actions.changeFontSize(change)
    }
  }
}

/**
 * Replaces Electron's default menu, which offers reload and DevTools in packaged builds too. A
 * smoke test has no session, so it passes no actions and gets only Help. The font shortcuts include
 * Shift because plain Ctrl+- belongs to the terminal.
 */
export function installAppMenu(actions?: SessionMenuActions): void {
  const view: MenuItemConstructorOptions | undefined =
    actions === undefined
      ? undefined
      : {
          label: 'View',
          submenu: [
            fontSizeItem(actions, 'Larger text', 'Ctrl+Shift+=', 'larger'),
            fontSizeItem(actions, 'Smaller text', 'Ctrl+Shift+-', 'smaller'),
            fontSizeItem(actions, 'Default text size', 'Ctrl+Shift+0', 'reset')
          ]
        }
  const file: MenuItemConstructorOptions | undefined =
    actions === undefined
      ? undefined
      : {
          label: 'File',
          submenu: [
            {
              label: 'Change folder...',
              click: () => {
                actions.changeFolder().catch((error: unknown) => {
                  log.error('Could not change the project folder', error)
                })
              }
            }
          ]
        }
  const help: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Open logs folder',
        click: () => {
          openLogsFolder().catch((error: unknown) => {
            log.error('Could not open the logs folder', error)
          })
        }
      }
    ]
  }
  const devTools: MenuItemConstructorOptions = {
    label: 'Developer',
    // No accelerators: Ctrl+R and friends belong to the terminal.
    submenu: [
      { role: 'reload', registerAccelerator: false },
      { role: 'toggleDevTools', registerAccelerator: false }
    ]
  }
  const microphone = actions === undefined ? undefined : microphoneMenu(actions)
  const items = [file, view, microphone, help, app.isPackaged ? undefined : devTools]
  Menu.setApplicationMenu(Menu.buildFromTemplate(items.filter((item) => item !== undefined)))
}
