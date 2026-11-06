import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// The real app with the fake Claude: closing the window keeps it in the tray (S7.1).
// Needs `npm run build` first.

const DESKTOP = join(__dirname, '../..')
const FAKE = join(DESKTOP, 'test/fake-claude.mjs')

let dir: string
let app: ElectronApplication

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-e2e-tray-'))
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      // Not the default, which a running daily copy may hold.
      hotkey: 'Control+Shift+F10',
      claude: { projectDir: dir },
      ui: { notifications: false, sounds: false }
    })
  )
  app = await _electron.launch({
    args: [DESKTOP, `--user-data-dir=${dir}`],
    cwd: DESKTOP,
    env: {
      ...process.env,
      VOICEUP_E2E: '1',
      VOICEUP_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
      VOICEUP_FAKE_LIVE: join(dir, 'prompts.txt'),
      CLAUDE_CONFIG_DIR: dir
    }
  })
})

test.afterEach(async () => {
  await app.close().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })
})

async function terminal(): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('terminal')), { timeout: 20000 })
    .toBe(true)
  const page = app.windows().find((candidate) => candidate.url().includes('terminal'))
  if (page === undefined) throw new Error('No terminal window')
  await expect(page.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })
  return page
}

/** The terminal window's state, read in main. */
const terminalWindow = (): Promise<{ visible: boolean; destroyed: boolean } | null> =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('terminal')
    )
    return window === undefined
      ? null
      : { visible: window.isVisible(), destroyed: window.isDestroyed() }
  })

test('closing the window hides it in the tray, and Claude keeps running', async () => {
  const page = await terminal()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('terminal'))
      ?.close()
  })
  await expect.poll(terminalWindow).toEqual({ visible: false, destroyed: false })
  // The session is still there: Claude's status still comes through.
  await expect(page.locator('#status-label')).toHaveText('Ready')
  expect(app.process().exitCode).toBeNull()

  // A second start is how a shortcut or the taskbar pin brings it back.
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('second-instance')
  })
  await expect.poll(terminalWindow).toEqual({ visible: true, destroyed: false })
})

test('Quit still quits, Claude included', async () => {
  await terminal()
  const exited = new Promise<number | null>((resolve) => {
    app.process().once('exit', resolve)
  })
  await app.evaluate(({ app: electronApp }) => {
    electronApp.quit()
  })
  expect(await exited).toBe(0)
})
