import { statSync } from 'node:fs'
import { app, dialog, type BrowserWindow } from 'electron'

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // Missing or unreadable: the caller asks for another folder.
    return false
  }
}

/** The Windows folder picker. Null if the user cancels. */
export async function pickProjectFolder(
  window: BrowserWindow,
  current: string | null
): Promise<string | null> {
  if (window.isDestroyed()) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Choose a project folder for Claude Code',
    defaultPath: current ?? app.getPath('home'),
    properties: ['openDirectory']
  })
  return canceled ? null : (filePaths.at(0) ?? null)
}
