import { writeFile } from 'node:fs/promises'
import { app } from 'electron'
import { log } from './log'
import { createWindow, loadRenderer } from './windows/factory'

/** Loads the terminal page in a hidden window. A failed load or a console error is a failure. */
async function checkRenderer(): Promise<'ok' | 'failed'> {
  const window = createWindow('terminal', { showWhenReady: false })
  const consoleErrors: string[] = []
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      consoleErrors.push(details.message)
      log.error(`Smoke test renderer error: ${details.message}`)
    }
  })

  try {
    await loadRenderer(window, 'terminal')
    return consoleErrors.length === 0 ? 'ok' : 'failed'
  } catch (error: unknown) {
    log.error('Smoke test could not load the renderer', error)
    return 'failed'
  }
}

/**
 * Proves a packaged build starts and serves its renderer over app:// (TECH_SPEC §7.2): writes a
 * JSON result and exits 0, or exits 1. S1.1 adds node-pty and S4.2 adds speech. The result goes
 * to a file because a GUI exe has no reliable stdout.
 */
export async function runSmokeTest(resultPath: string): Promise<void> {
  try {
    const renderer = await checkRenderer()
    await writeFile(resultPath, JSON.stringify({ app: 'ok', renderer }))
    app.exit(renderer === 'ok' ? 0 : 1)
  } catch (error: unknown) {
    log.error(`Smoke test failed writing ${resultPath}`, error)
    app.exit(1)
  }
}
