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
  },
  overlay: {
    preload: 'overlay.js',
    options: {
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // Never takes focus, so the user keeps typing where they were.
      focusable: false
    },
    webPreferences: { autoplayPolicy: 'no-user-gesture-required' }
  },
  recorder: {
    preload: 'recorder.js',
    options: {},
    // Never shown, and it has to keep capturing while hidden, with no click to allow audio.
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  },
  wizard: {
    preload: 'wizard.js',
    options: { width: 720, height: 480, minWidth: 560, minHeight: 360, backgroundColor: '#1e1e20' }
  }
} satisfies Record<
  string,
  {
    preload: string
    options: BrowserWindowConstructorOptions
    webPreferences?: BrowserWindowConstructorOptions['webPreferences']
  }
>

export type WindowKind = keyof typeof WINDOWS
export const WINDOW_KINDS = Object.keys(WINDOWS) as WindowKind[]

const kindsByWebContentsId = new Map<number, WindowKind>()

/** The kind of window a webContents belongs to, used to validate IPC senders (rule 8). */
export function windowKindOf(webContentsId: number): WindowKind | undefined {
  return kindsByWebContentsId.get(webContentsId)
}

export function windowOptions(kind: WindowKind): BrowserWindowConstructorOptions {
  const window: (typeof WINDOWS)[WindowKind] = WINDOWS[kind]
  const { preload, options } = window
  const extras = 'webPreferences' in window ? window.webPreferences : {}
  return {
    ...options,
    show: false,
    webPreferences: {
      ...extras,
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
