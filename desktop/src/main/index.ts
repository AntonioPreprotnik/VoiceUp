import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createMainWindow(rendererUrl: string): void {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/terminal.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.loadURL(new URL('terminal/index.html', rendererUrl).href).catch((error: unknown) => {
    console.error('Failed to load the main window', error)
    app.exit(1)
  })
}

app
  .whenReady()
  .then(() => {
    // Only the dev server can serve renderers until S0.4 adds app://. file:// is forbidden.
    const rendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl === undefined) {
      console.error('No renderer source: run "npm run dev". Packaged loading arrives with S0.4.')
      app.exit(1)
      return
    }
    createMainWindow(rendererUrl)
  })
  .catch((error: unknown) => {
    console.error('Startup failed', error)
    app.exit(1)
  })

app.on('window-all-closed', () => app.quit())
