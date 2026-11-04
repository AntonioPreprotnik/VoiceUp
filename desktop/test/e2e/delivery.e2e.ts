import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// The real app with the fake Claude (TECH_SPEC §8): real windows, hook server, state tracker, gate
// and delivery, through a real PTY. CI has no microphone or model, so text enters at delivery.
// Needs `npm run build` first.

const DESKTOP = join(__dirname, '../..')

interface E2eStatus {
  state: string
  promptDirty: boolean
  holding: boolean
}

interface Session {
  app: ElectronApplication
  terminal: Page
  overlay: Page
  received: () => string[]
  dir: string
}

let session: Session

async function windowAt(app: ElectronApplication, path: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(path)), { timeout: 20000 })
    .toBe(true)
  const page = app.windows().find((candidate) => candidate.url().includes(path))
  if (page === undefined) throw new Error(`No window at ${path}`)
  return page
}

async function open(): Promise<Session> {
  const dir = mkdtempSync(join(tmpdir(), 'voiceup-e2e-'))
  const log = join(dir, 'prompts.txt')
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      claude: { projectDir: dir },
      ui: { notifications: false, sounds: false }
    })
  )
  const fake = join(DESKTOP, 'test/fake-claude.mjs')
  const app = await _electron.launch({
    // The folder, not the script: Electron takes the app's path from it, and finds resources there.
    args: [DESKTOP, `--user-data-dir=${dir}`],
    cwd: DESKTOP,
    env: {
      ...process.env,
      VOICEUP_E2E: '1',
      VOICEUP_CLAUDE_CMD: JSON.stringify([process.execPath, fake]),
      VOICEUP_FAKE_LIVE: log,
      // Nothing from the real Claude's settings can reach this test.
      CLAUDE_CONFIG_DIR: dir
    }
  })
  return {
    app,
    dir,
    terminal: await windowAt(app, 'terminal'),
    overlay: await windowAt(app, 'overlay'),
    received: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : []
  }
}

/** "loading" until the terminal page has loaded, which is when the app adds this. */
function status(): Promise<E2eStatus> {
  return session.app.evaluate(() => {
    const api = (globalThis as unknown as { voiceupE2e?: { status(): E2eStatus } }).voiceupE2e
    return api?.status() ?? { state: 'loading', promptDirty: false, holding: false }
  })
}

function act(method: 'deliver' | 'retry' | 'discard', text = ''): Promise<void> {
  return session.app.evaluate(
    (_electronModule, [name, value]) => {
      const api = (globalThis as unknown as { voiceupE2e: Record<string, (text: string) => void> })
        .voiceupE2e
      api[name](value)
    },
    [method, text] as const
  )
}

const stateIs = async (state: string): Promise<void> => {
  await expect.poll(async () => (await status()).state, { timeout: 15000 }).toBe(state)
}

const holdingIs = async (holding: boolean): Promise<void> => {
  await expect.poll(async () => (await status()).holding).toBe(holding)
}

/** Enough for a send that should not happen to have happened: paste, Enter and hook. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1000))

test.beforeEach(async () => {
  session = await open()
  await stateIs('idle')
})

test.afterEach(async () => {
  await session.app.close()
  rmSync(session.dir, { recursive: true, force: true })
})

test('text reaches the prompt and is submitted, and the status bar follows', async () => {
  await expect(session.terminal.locator('#status-label')).toHaveText('Ready')
  await act('deliver', 'list the files in this folder')
  await expect.poll(session.received).toEqual(['list the files in this folder'])
  await stateIs('idle')
  expect((await status()).holding).toBe(false)
})

test('text starting with a slash arrives as text, with a space in front', async () => {
  await act('deliver', '/clear')
  await expect.poll(session.received).toEqual([' /clear'])
})

test('text is blocked at a permission prompt, then discarded', async () => {
  await act('deliver', 'please ask permission')
  await stateIs('awaitingPermission')
  await expect(session.terminal.locator('#status-label')).toHaveText('Needs permission')

  await act('deliver', 'this must never arrive')
  await holdingIs(true)
  await expect(session.overlay.locator('#text')).toContainText('waiting for you')
  await settle()
  expect(session.received()).toEqual(['please ask permission'])

  await act('retry')
  await settle()
  expect(session.received()).toEqual(['please ask permission'])
  expect((await status()).holding).toBe(true)

  await act('discard')
  await holdingIs(false)
  expect(session.received()).toEqual(['please ask permission'])
})

test('text is blocked over half-typed text, and sent once that is cleared', async () => {
  await session.terminal.locator('#terminal').click()
  await session.terminal.keyboard.type('half typed')
  await expect.poll(async () => (await status()).promptDirty).toBe(true)

  await act('deliver', 'run the tests')
  await holdingIs(true)
  await expect(session.overlay.locator('#text')).toContainText('unsent text')
  await settle()
  expect(session.received()).toEqual([])

  await session.terminal.keyboard.press('Control+C')
  await expect.poll(async () => (await status()).promptDirty).toBe(false)
  await act('retry')
  await expect.poll(session.received).toEqual(['run the tests'])
})

test('text over the limit is not sent at all', async () => {
  await act('deliver', 'word '.repeat(200))
  await expect(session.overlay.locator('#text')).toContainText('too long')
  await settle()
  expect(session.received()).toEqual([])
  expect((await status()).holding).toBe(false)
})
