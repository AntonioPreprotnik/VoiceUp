import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// The real wizard window with the fake Claude, starting from an empty data folder as a new user
// does. Real clicks and a real restart, so resuming is proven against the saved file.
// Needs `npm run build` first.

const DESKTOP = join(__dirname, '../..')
const FAKE = join(DESKTOP, 'test/fake-claude.mjs')

let dir: string
let app: ElectronApplication

function launch(): Promise<ElectronApplication> {
  return _electron.launch({
    args: [DESKTOP, `--user-data-dir=${dir}`],
    cwd: DESKTOP,
    env: {
      ...process.env,
      VOICEUP_E2E: '1',
      VOICEUP_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
      CLAUDE_CONFIG_DIR: dir
    }
  })
}

async function windowAt(path: string): Promise<Page> {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(path)), { timeout: 20000 })
    .toBe(true)
  const page = app.windows().find((candidate) => candidate.url().includes(path))
  if (page === undefined) throw new Error(`No window at ${path}`)
  return page
}

const hasWindowAt = (path: string): boolean =>
  app.windows().some((page) => page.url().includes(path))

const savedWizard = (): unknown =>
  (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { wizard: unknown }).wizard

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-e2e-wizard-'))
})

test.afterEach(async () => {
  await app.close().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('a new user walks through the wizard, resumes after quitting, then reaches Claude', async () => {
  // A folder already set, or Claude waits at the native folder picker, which this can't click.
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ version: 1, claude: { projectDir: dir }, wizard: { done: false } })
  )
  app = await launch()
  let wizard = await windowAt('wizard')
  await expect(wizard.locator('#title')).toHaveText('Claude Code')
  await expect(wizard.locator('#back')).toBeDisabled()
  expect(hasWindowAt('terminal')).toBe(false)

  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Project folder')
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Sign in')
  await wizard.locator('#back').click()
  await expect(wizard.locator('#title')).toHaveText('Project folder')
  expect(savedWizard()).toEqual({ done: false, completed: ['claudeCode', 'projectFolder'] })

  // Closing the window is how a user quits halfway.
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await wizard.close()
  await exited

  app = await launch()
  wizard = await windowAt('wizard')
  await expect(wizard.locator('#title')).toHaveText('Sign in')
  await expect(wizard.locator('#position')).toHaveText('Step 3 of 6')
  await expect(wizard.locator('li[data-done="true"]')).toHaveCount(2)

  for (const title of ['Speech model', 'Claude in Chrome', 'Microphone and hotkey']) {
    await wizard.locator('#continue').click()
    await expect(wizard.locator('#title')).toHaveText(title)
  }
  await expect(wizard.locator('#continue')).toHaveText('Finish')
  await wizard.locator('#continue').click()

  const terminal = await windowAt('terminal')
  await expect(terminal.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })
  await expect.poll(() => hasWindowAt('wizard')).toBe(false)
  expect(savedWizard()).toMatchObject({ done: true })
})

test('an empty data folder starts it, and it does not come back after finishing', async () => {
  app = await launch()
  const wizard = await windowAt('wizard')
  for (let step = 0; step < 6; step++) await wizard.locator('#continue').click()
  await windowAt('terminal')
  await app.close()

  app = await launch()
  await windowAt('terminal')
  expect(hasWindowAt('wizard')).toBe(false)
})
