import { mkdir } from 'node:fs/promises'
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { FontSizeChange } from '../core/fontSize'
import type { MicDevice } from '../shared/ipcChannels'
import type { ModelId } from '../shared/models'
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
  readonly speechModel: SpeechModelMenu
}

/** A stand-in for the settings screen, S6.6. */
export interface SpeechModelMenu {
  readonly choices: readonly { id: ModelId; label: string; checked: boolean }[]
  /** Shown greyed out, such as what's downloading and the disk usage. */
  readonly notes: readonly string[]
  readonly canRetry: boolean
  readonly select: (id: ModelId) => void
  readonly retry: () => void
}

function speechModelMenu(menu: SpeechModelMenu): MenuItemConstructorOptions {
  return {
    label: 'Speech model',
    submenu: [
      ...menu.choices.map(({ id, label, checked }): MenuItemConstructorOptions => ({
        label,
        type: 'radio',
        checked,
        click: () => {
          menu.select(id)
        }
      })),
      { type: 'separator' },
      ...(menu.canRetry
        ? [
            {
              label: 'Retry download',
              click: () => {
                menu.retry()
              }
            }
          ]
        : []),
      ...menu.notes.map((label) => ({ label, enabled: false }))
    ]
  }
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
  const speechModel = actions === undefined ? undefined : speechModelMenu(actions.speechModel)
  const items = [file, view, microphone, speechModel, help, app.isPackaged ? undefined : devTools]
  Menu.setApplicationMenu(Menu.buildFromTemplate(items.filter((item) => item !== undefined)))
}
