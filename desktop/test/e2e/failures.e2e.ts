import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Failures Claude reports through its hooks reach the user as a notice (S7.2), with the real app and
// the fake Claude. Needs `npm run build` first.

const DESKTOP = join(__dirname, '../..')
const FAKE = join(DESKTOP, 'test/fake-claude.mjs')

let dir: string
let app: ElectronApplication

async function windowAt(path: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(path)), { timeout: 20000 })
    .toBe(true)
  const page = app.windows().find((candidate) => candidate.url().includes(path))
  if (page === undefined) throw new Error(`No window at ${path}`)
  return page
}

function deliver(text: string): Promise<void> {
  return app.evaluate((_electronModule, value) => {
    const api = (globalThis as unknown as { voiceupE2e: { deliver(text: string): void } })
      .voiceupE2e
    api.deliver(value)
  }, text)
}

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-e2e-failures-'))
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      // Not the default, which a running daily copy may hold.
      hotkey: 'Control+Shift+F10',
      claude: { projectDir: dir, browserControl: true },
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
      VOICEUP_FAKE_BROWSER: 'disconnected',
      CLAUDE_CONFIG_DIR: dir
    }
  })
})

test.afterEach(async () => {
  await app.close().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('a browser Claude cannot reach is reported, with what to do', async () => {
  const terminal = await windowAt('terminal')
  const overlay = await windowAt('overlay')
  await expect(terminal.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })
  await deliver('Use the browser to open https://example.com')
  await expect(overlay.locator('#text')).toContainText('can’t reach your browser')
  await expect(overlay.locator('#text')).toContainText('/chrome')
  await expect(terminal.locator('#status-label')).toHaveText('Ready')
})

test('a failed turn says whether to sign in, and voice keeps working', async () => {
  const terminal = await windowAt('terminal')
  const overlay = await windowAt('overlay')
  await expect(terminal.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })

  await deliver('fail turn authentication_failed')
  await expect(overlay.locator('#text')).toContainText("isn't signed in")
  await expect(overlay.locator('#text')).toContainText('/login')
  await expect(terminal.locator('#status-label')).toHaveText('Ready')

  // Offline, rate limited or anything else: Claude's own message is in the terminal.
  await deliver('fail turn server_error')
  await expect(overlay.locator('#text')).toContainText('couldn’t answer')
  await expect(terminal.locator('#status-label')).toHaveText('Ready')
})
