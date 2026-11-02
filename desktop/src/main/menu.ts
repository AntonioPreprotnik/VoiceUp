import { mkdir } from 'node:fs/promises'
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { log, logsDirectory } from './log'

async function openLogsFolder(): Promise<void> {
  const directory = logsDirectory()
  await mkdir(directory, { recursive: true })
  const failure = await shell.openPath(directory)
  if (failure !== '') log.error(`Could not open the logs folder ${directory}: ${failure}`)
}

/** Replaces Electron's default menu, which offers reload and DevTools in packaged builds too. */
export function installAppMenu(): void {
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
    submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }]
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(app.isPackaged ? [help] : [help, devTools]))
}
