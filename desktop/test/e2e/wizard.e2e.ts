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
      // Live, so the fake answers what is typed. A replayed scenario answers on a fixed clock,
      // which only matches a click by luck, and not on a slower machine.
      VOICEUP_FAKE_LIVE: join(dir, 'prompts.txt'),
      // A pretend Chrome with the extension, unless a test builds its own.
      VOICEUP_TEST_BROWSER_ROOT: join(dir, 'browsers'),
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

const EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'

/** Only file existence matters to the check, so empty files and folders are a browser here. */
function fakeBrowser(root: string, vendor: string, exe: string, extension: boolean): string {
  const program = join(root, 'Program Files', vendor, 'Application')
  mkdirSync(program, { recursive: true })
  writeFileSync(join(program, exe), '')
  const extensions = join(root, 'Local', vendor, 'User Data', 'Default', 'Extensions')
  mkdirSync(extensions, { recursive: true })
  if (extension) mkdirSync(join(extensions, EXTENSION_ID))
  return join(extensions, EXTENSION_ID)
}

const savedBrowserControl = (): unknown =>
  (
    JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      claude: { browserControl: unknown }
    }
  ).claude.browserControl

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

/** On the Sign in step: Claude starts by itself, and the test needs a click. */
async function passSignIn(wizard: Page): Promise<void> {
  await expect(wizard.locator('#title')).toHaveText('Sign in')
  await expect(wizard.locator('#continue')).toBeDisabled()
  await wizard.locator('#sign-in-test').click({ timeout: 20000 })
  await expect(wizard.locator('#sign-in-message')).toContainText('signed in', { timeout: 20000 })
}

/** The fake Claude opens the page only when it was started with --chrome. */
async function passBrowserTest(wizard: Page): Promise<void> {
  await expect(wizard.locator('#continue')).toBeDisabled()
  await wizard.locator('#browser-test-run').click({ timeout: 20000 })
  await expect(wizard.locator('#browser-test-message')).toHaveText(
    'Claude opened the page, so browser control works.',
    { timeout: 30000 }
  )
  await expect(wizard.locator('#continue')).toBeEnabled()
}

const savedWizard = (): unknown =>
  (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { wizard: unknown }).wizard

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-e2e-wizard-'))
  fakeBrowser(join(dir, 'browsers'), 'Google/Chrome', 'chrome.exe', true)
})

test.afterEach(async () => {
  await app.close().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('a new user walks through the wizard, resumes after quitting, then reaches Claude', async () => {
  // A folder already set, or Claude waits at the native folder picker, which this can't click.
  writeFileSync(
    join(dir, 'settings.json'),
    // Past the model and microphone steps: CI has neither the model nor a microphone.
    JSON.stringify({
      version: 1,
      claude: { projectDir: dir },
      wizard: { done: false, completed: ['speechModel', 'micAndHotkey'] }
    })
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
  expect(savedWizard()).toEqual({
    done: false,
    completed: ['speechModel', 'micAndHotkey', 'claudeCode', 'projectFolder']
  })

  // Closing the window is how a user quits halfway.
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await wizard.close()
  await exited

  app = await launch()
  wizard = await windowAt('wizard')
  await expect(wizard.locator('#title')).toHaveText('Sign in')
  await expect(wizard.locator('#position')).toHaveText('Step 3 of 6')
  await expect(wizard.locator('li[data-done="true"]')).toHaveCount(4)

  await passSignIn(wizard)
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Speech model')
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Claude in Chrome')
  // Claude runs from Sign in without --chrome, so the test restarts it with browser control.
  await passBrowserTest(wizard)
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Microphone and hotkey')
  await expect(wizard.locator('#continue')).toHaveText('Finish')
  await wizard.locator('#continue').click()

  const terminal = await windowAt('terminal')
  await expect(terminal.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })
  await expect.poll(() => hasWindowAt('wizard')).toBe(false)
  expect(savedWizard()).toMatchObject({ done: true })

  // It does not come back.
  await app.close()
  app = await launch()
  await windowAt('terminal')
  expect(hasWindowAt('wizard')).toBe(false)
})

test('a new user chooses a folder in the wizard, and Claude starts there at Sign in', async () => {
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

  await wizard.locator('#continue').click()
  // Claude starts here, in the chosen folder. The steps after this need a model and a microphone.
  await passSignIn(wizard)
  const terminal = await windowAt('terminal')
  await expect(terminal.locator('#status-label')).toHaveText('Ready')
  expect(await pickerUses()).toBe(1)
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

test('Sign in starts Claude beside the wizard, and only the test passes it', async () => {
  const log = join(dir, 'prompts.txt')
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      claude: { projectDir: dir },
      wizard: { done: false, completed: ['claudeCode', 'projectFolder'] }
    })
  )
  app = await launch({ VOICEUP_FAKE_LIVE: log, ANTHROPIC_API_KEY: 'not-a-real-key' })
  const wizard = await windowAt('wizard')
  await expect(wizard.locator('#title')).toHaveText('Sign in')
  await expect(wizard.locator('#sign-in-key')).toContainText('bills the API')
  await expect(wizard.locator('body')).not.toContainText('not-a-real-key')
  const terminal = await windowAt('terminal')
  await expect(terminal.locator('#status-label')).toHaveText('Ready', { timeout: 20000 })
  // Ready alone sends nothing: the test is the user's click.
  await expect(wizard.locator('#sign-in-test')).toBeEnabled()
  expect(existsSync(log)).toBe(false)
  await expect(wizard.locator('#continue')).toBeDisabled()

  await wizard.locator('#sign-in-test').click()
  await expect(wizard.locator('#sign-in-message')).toContainText('signed in', { timeout: 20000 })
  expect(readFileSync(log, 'utf8').trim()).toBe('reply with OK')
  await expect(wizard.locator('#continue')).toBeEnabled()
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Speech model')
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

test('Claude in Chrome is required: it waits for the extension and a browser test that opens a page', async () => {
  const root = join(dir, 'brave-only')
  const extension = fakeBrowser(root, 'BraveSoftware/Brave-Browser', 'brave.exe', false)
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      claude: { projectDir: dir },
      wizard: {
        done: false,
        completed: ['claudeCode', 'projectFolder', 'signIn', 'speechModel', 'micAndHotkey']
      }
    })
  )
  app = await launch({ VOICEUP_TEST_BROWSER_ROOT: root })
  const wizard = await windowAt('wizard')
  await expect(wizard.locator('#title')).toHaveText('Claude in Chrome')
  await expect(wizard.locator('#chrome-message')).toContainText('Chrome Web Store')
  await expect(wizard.locator('#chrome-open-brave')).toBeVisible()
  await expect(wizard.locator('#chrome-open-chrome')).toBeHidden()
  await expect(wizard.locator('#continue')).toBeDisabled()

  mkdirSync(extension)
  await wizard.locator('#chrome-check').click()
  await expect(wizard.locator('#chrome-message')).toHaveText(
    'Claude in Chrome is installed in Brave.'
  )
  expect(savedBrowserControl()).toBe(false)
  // Sign in was done in an earlier run, so the test starts Claude itself, with --chrome.
  await passBrowserTest(wizard)
  expect(savedBrowserControl()).toBe(true)
  await wizard.locator('#continue').click()
  await expect(wizard.locator('#title')).toHaveText('Microphone and hotkey')
})

test('a browser Claude can not reach fails the test, with the documented fixes', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      claude: { projectDir: dir },
      wizard: {
        done: false,
        completed: ['claudeCode', 'projectFolder', 'signIn', 'speechModel', 'micAndHotkey']
      }
    })
  )
  app = await launch({ VOICEUP_FAKE_BROWSER: 'disconnected' })
  const wizard = await windowAt('wizard')
  await wizard.locator('#browser-test-run').click({ timeout: 20000 })
  await expect(wizard.locator('#browser-test-message')).toContainText(
    'Claude couldn’t use your browser',
    { timeout: 30000 }
  )
  await expect(wizard.locator('#browser-test-message')).toContainText('Reconnect extension')
  await expect(wizard.locator('#browser-test-restart')).toBeVisible()
  await expect(wizard.locator('#browser-test-run')).toHaveText('Test again')
  await expect(wizard.locator('#continue')).toBeDisabled()
})

test('with neither browser the step says so, and the user can still confirm it by hand', async () => {
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      claude: { projectDir: dir },
      wizard: {
        done: false,
        completed: ['claudeCode', 'projectFolder', 'signIn', 'speechModel', 'micAndHotkey']
      }
    })
  )
  app = await launch({ VOICEUP_TEST_BROWSER_ROOT: join(dir, 'nothing') })
  const wizard = await windowAt('wizard')
  await expect(wizard.locator('#chrome-message')).toContainText('neither is installed')
  await expect(wizard.locator('#continue')).toBeDisabled()
  await wizard.locator('#chrome-confirm').click()
  await expect(wizard.locator('#chrome-message')).toHaveText(
    'You said Claude in Chrome is installed.'
  )
  await expect(wizard.locator('#browser-test-run')).toBeVisible()
  // Saying so isn't enough: the browser test still has to pass.
  await expect(wizard.locator('#continue')).toBeDisabled()
})
