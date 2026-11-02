import { join } from 'node:path'
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { rendererEntryUrl } from '../../core/appUrl'
import { rendererMode } from '../rendererMode'

// Every window is created here, so the security rules below hold for all of them.
// Add a new kind to this table; factory.test.ts then covers it automatically.
const WINDOWS = {
  terminal: {
    // Security rule 2: one dedicated preload per window kind.
    preload: 'terminal.js',
    options: { width: 900, height: 670, autoHideMenuBar: true, backgroundColor: '#0c0c0c' }
  }
} satisfies Record<string, { preload: string; options: BrowserWindowConstructorOptions }>

export type WindowKind = keyof typeof WINDOWS
export const WINDOW_KINDS = Object.keys(WINDOWS) as WindowKind[]

const kindsByWebContentsId = new Map<number, WindowKind>()

/** The kind of window a webContents belongs to, used to validate IPC senders (rule 8). */
export function windowKindOf(webContentsId: number): WindowKind | undefined {
  return kindsByWebContentsId.get(webContentsId)
}

export function windowOptions(kind: WindowKind): BrowserWindowConstructorOptions {
  const { preload, options } = WINDOWS[kind]
  return {
    ...options,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload', preload),
      // Security rule 1: isolated, sandboxed, no Node in renderers.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  }
}

export function createWindow(kind: WindowKind, { showWhenReady = true } = {}): BrowserWindow {
  const window = new BrowserWindow(windowOptions(kind))

  const { webContents } = window
  const webContentsId = webContents.id
  kindsByWebContentsId.set(webContentsId, kind)
  window.once('closed', () => {
    kindsByWebContentsId.delete(webContentsId)
  })

  // Security rule 5: no navigation and no new windows, ever.
  webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (showWhenReady) {
    window.once('ready-to-show', () => {
      window.show()
    })
  }
  return window
}

/** Security rule 3: loads the bundled page, or the dev server when !app.isPackaged. */
export function loadRenderer(window: BrowserWindow, kind: WindowKind): Promise<void> {
  return window.loadURL(rendererEntryUrl(kind, rendererMode()))
}
