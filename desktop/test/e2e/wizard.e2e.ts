import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function launch(env: Record<string, string> = {}): Promise<ElectronApplication> {
  return _electron.launch({
    args: [DESKTOP, `--user-data-dir=${dir}`],
    cwd: DESKTOP,
    env: {
      ...process.env,
      VOICEUP_E2E: '1',
      VOICEUP_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
      CLAUDE_CONFIG_DIR: dir,
      ...env
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

const savedProjectDir = (): unknown =>
  (
    JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      claude: { projectDir: unknown }
    }
  ).claude.projectDir

/** The Windows picker can't be clicked from here, so only it is replaced. Null means cancel. */
async function stubPicker(answer: string | null): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    const stubbed = globalThis as unknown as { voiceupPickerUses: number }
    stubbed.voiceupPickerUses = 0
    dialog.showOpenDialog = () => {
      stubbed.voiceupPickerUses++
      return Promise.resolve(
        folder === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [folder] }
      )
    }
  }, answer)
}

const pickerUses = (): Promise<number> =>
  app.evaluate(() => (globalThis as unknown as { voiceupPickerUses: number }).voiceupPickerUses)

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

test('a new user chooses a folder in the wizard, and Claude starts there with no second picker', async () => {
  app = await launch()
  const wizard = await windowAt('wizard')
  await stubPicker(dir)
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Project folder')
  await expect(wizard.locator('#continue')).toBeDisabled()
  await expect(wizard.locator('#folder-path')).toBeHidden()

  await wizard.locator('#folder-choose').click()
  await expect(wizard.locator('#folder-path')).toHaveText(dir)
  await expect(wizard.locator('#folder-choose')).toHaveText('Change folder')
  expect(savedProjectDir()).toBe(dir)

  for (let step = 0; step < 5; step++) await wizard.locator('#continue').click()
  const terminal = await windowAt('terminal')
  await expect(terminal.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })
  expect(await pickerUses()).toBe(1)
  await app.close()

  app = await launch()
  await windowAt('terminal')
  expect(hasWindowAt('wizard')).toBe(false)
})

test('cancelling the picker changes nothing', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ version: 1, wizard: { done: false, completed: ['claudeCode'] } })
  )
  app = await launch()
  const wizard = await windowAt('wizard')
  await stubPicker(null)
  await wizard.locator('#folder-choose').click()
  await expect.poll(pickerUses).toBe(1)
  await expect(wizard.locator('#continue')).toBeDisabled()
  await expect(wizard.locator('#folder-path')).toBeHidden()
  expect(savedProjectDir()).toBeNull()
})

test('a saved folder is shown and can be kept, and a deleted one has to be replaced', async () => {
  const kept = join(dir, 'kept')
  mkdirSync(kept)
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      claude: { projectDir: kept },
      wizard: { done: false, completed: ['claudeCode'] }
    })
  )
  app = await launch()
  const wizard = await windowAt('wizard')
  await expect(wizard.locator('#folder-path')).toHaveText(kept)
  await expect(wizard.locator('#continue')).toBeEnabled()

  const closed = new Promise((resolve) => app.process().once('exit', resolve))
  await wizard.close()
  await closed
  rmSync(kept, { recursive: true })

  app = await launch()
  const again = await windowAt('wizard')
  await expect(again.locator('#folder-message')).toContainText('no longer exists')
  await expect(again.locator('#folder-path')).toHaveText(kept)
  await expect(again.locator('#continue')).toBeDisabled()
})

test('it installs Claude when asked, shows the output, and only then lets you continue', async () => {
  const commandFile = join(dir, 'claude-command.json')
  const command = JSON.stringify([process.execPath, FAKE]).replace(/'/g, "''")
  app = await launch({
    VOICEUP_CLAUDE_CMD_FILE: commandFile,
    VOICEUP_INSTALL_SCRIPT: `Write-Output 'fake installer ran'; Set-Content -Path '${commandFile}' -Value '${command}'`
  })
  const wizard = await windowAt('wizard')
  await expect(wizard.locator('#claude-command')).toHaveText(
    'irm https://claude.ai/install.ps1 | iex'
  )
  await expect(wizard.locator('#claude-git')).toContainText('optional')
  await expect(wizard.locator('#continue')).toBeDisabled()
  expect(existsSync(commandFile)).toBe(false)

  await wizard.locator('#claude-install').click()
  await expect(wizard.locator('#claude-output')).toContainText('fake installer ran')
  await expect(wizard.locator('#claude-message')).toContainText('2.1.318 found')
  await expect(wizard.locator('#continue')).toBeEnabled()
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Project folder')
})

test('a failed install says so, and can be tried again', async () => {
  const commandFile = join(dir, 'claude-command.json')
  app = await launch({
    VOICEUP_CLAUDE_CMD_FILE: commandFile,
    VOICEUP_INSTALL_SCRIPT:
      '1..40 | ForEach-Object { Write-Output "line $_" }; Write-Output \'no connection\'; exit 1'
  })
  const wizard = await windowAt('wizard')
  await wizard.locator('#claude-install').click()
  await expect(wizard.locator('#claude-install')).toHaveText('Try again')
  await expect(wizard.locator('#claude-output')).toContainText('no connection')
  // The last lines explain the failure, and the buttons appearing makes the box shorter.
  const hiddenBelow = await wizard.evaluate<number>(
    "(() => { const box = document.getElementById('claude-output'); return box.scrollHeight - box.clientHeight - box.scrollTop })()"
  )
  expect(hiddenBelow).toBeLessThanOrEqual(1)
  await expect(wizard.locator('#continue')).toBeDisabled()
})

test('a Claude that is too old holds the wizard, and shows the update command', async () => {
  app = await launch({ VOICEUP_FAKE_VERSION: '2.0.0' })
  const wizard = await windowAt('wizard')
  await expect(wizard.locator('#claude-message')).toContainText('2.0.0 is too old')
  await expect(wizard.locator('#claude-command')).toHaveText('claude update')
  await expect(wizard.locator('#claude-install')).toBeHidden()
  await expect(wizard.locator('#continue')).toBeDisabled()
})

test('a Claude that is too old stops a set-up copy, with the update command', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ version: 1, claude: { projectDir: dir } })
  )
  app = await launch({ VOICEUP_FAKE_VERSION: '2.0.0' })
  const terminal = await windowAt('terminal')
  await expect(terminal.locator('#session-exited-text')).toContainText('needs updating', {
    timeout: 20000
  })
  await expect(terminal.locator('#session-command-text')).toHaveText('claude update')
})
