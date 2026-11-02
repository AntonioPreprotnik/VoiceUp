import { mkdir } from 'node:fs/promises'
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { log, logsDirectory } from './log'

async function openLogsFolder(): Promise<void> {
  const directory = logsDirectory()
  await mkdir(directory, { recursive: true })
  const failure = await shell.openPath(directory)
  if (failure !== '') log.error(`Could not open the logs folder ${directory}: ${failure}`)
}

/**
 * Replaces Electron's default menu, which offers reload and DevTools in packaged builds too. A
 * smoke test has no session, so it passes no onChangeFolder and gets no File menu.
 */
export function installAppMenu(onChangeFolder?: () => Promise<void>): void {
  const file: MenuItemConstructorOptions | undefined =
    onChangeFolder === undefined
      ? undefined
      : {
          label: 'File',
          submenu: [
            {
              label: 'Change folder...',
              click: () => {
                onChangeFolder().catch((error: unknown) => {
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
  const items = [file, help, app.isPackaged ? undefined : devTools]
  Menu.setApplicationMenu(Menu.buildFromTemplate(items.filter((item) => item !== undefined)))
}
