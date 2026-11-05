import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// The real settings window, opened from the real File menu, with real typing and clicks.
// Needs `npm run build` first.

const DESKTOP = join(__dirname, '../..')
const FAKE = join(DESKTOP, 'test/fake-claude.mjs')

let dir: string
let app: ElectronApplication

interface Saved {
  hotkey: string
  delivery: { previewMs: number; queue: boolean }
  claude: { projectDir: string }
  logLevel: string
}

const saved = (): Saved => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Saved

async function openSettings(): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('terminal')), { timeout: 20000 })
    .toBe(true)
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      ?.items.find((item) => item.label === 'File')
      ?.submenu?.items.find((item) => item.label === 'Settings...')
      ?.click()
  })
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('settings')), { timeout: 20000 })
    .toBe(true)
  const page = app.windows().find((candidate) => candidate.url().includes('settings'))
  if (page === undefined) throw new Error('No settings window')
  await expect(page.locator('#hotkey-value')).not.toHaveText('')
  return page
}

const registered = (accelerator: string): Promise<boolean> =>
  app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), accelerator)

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-e2e-settings-'))
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

test('a change is saved as it is made, and a value out of range is refused with a reason', async () => {
  const page = await openSettings()
  await expect(page.locator('#previewMs')).toHaveValue('300')

  await page.locator('#previewMs').fill('500')
  await page.locator('#previewMs').press('Tab')
  await expect(page.locator('#status')).toHaveText('Saved.')
  expect(saved().delivery.previewMs).toBe(500)

  await page.locator('#previewMs').fill('99999')
  await page.locator('#previewMs').press('Tab')
  await expect(page.locator('[data-error-for="previewMs"]')).toHaveText('Choose from 0 to 5000 ms.')
  expect(saved().delivery.previewMs).toBe(500)

  await page.locator('#queue').click()
  await expect.poll(() => saved().delivery.queue).toBe(false)
  await page.locator('#logLevel').selectOption('debug')
  await expect(page.locator('#debug-warning')).toBeVisible()
  await expect.poll(() => saved().logLevel).toBe('debug')
})

test('a new hotkey is recorded from the keys, and replaces the old one', async () => {
  const page = await openSettings()
  await expect(page.locator('#hotkey-value')).toHaveText('Ctrl+Shift+F10')

  await page.locator('#hotkey-change').click()
  await page.keyboard.press('KeyA')
  await expect(page.locator('[data-error-for="hotkey"]')).toContainText('Add Ctrl, Alt')
  await page.keyboard.press('Control+Shift+F9')
  await expect(page.locator('#hotkey-value')).toHaveText('Ctrl+Shift+F9')
  await expect.poll(() => saved().hotkey).toBe('Control+Shift+F9')
  expect(await registered('Control+Shift+F9')).toBe(true)

  await page.locator('#hotkey-change').click()
  await page.keyboard.press('Control+Alt+F8')
  await expect(page.locator('#hotkey-warning')).toBeVisible()
})

test('reset puts the screen back and keeps the project folder', async () => {
  const page = await openSettings()
  await page.locator('#previewMs').fill('900')
  await page.locator('#previewMs').press('Tab')
  await expect.poll(() => saved().delivery.previewMs).toBe(900)

  await page.locator('#reset').click()
  await expect(page.locator('#previewMs')).toHaveValue('300')
  expect(saved().delivery.previewMs).toBe(300)
  expect(saved().claude.projectDir).toBe(dir)
  // The default hotkey may be held by a daily copy on a developer's PC, which the screen reports.
  expect(['Control+Shift+Space', 'Control+Shift+F10']).toContain(saved().hotkey)
})
