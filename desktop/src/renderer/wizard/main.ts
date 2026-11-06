import type {
  ChromeBrowser,
  ChromeStepStatus,
  ClaudeStepStatus,
  FolderStepStatus,
  MicStepStatus,
  ModelStepStatus,
  SignInStatus,
  WizardApi,
  WizardResult,
  WizardView
} from '../../shared/ipcChannels'

// The first-run wizard. Main holds the progress and decides what is allowed, so this only draws
// what it is sent. Everything is shown with textContent, never as markup.

declare global {
  interface Window {
    readonly voiceupWizard: WizardApi
  }
}

const MAX_OUTPUT_CHARS = 20000

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`The wizard page is missing #${id}`)
  return found
}

function button(id: string): HTMLButtonElement {
  return element(id) as HTMLButtonElement
}

const steps = element('steps')
const position = element('position')
const title = element('title')
const detail = element('detail')
const notice = element('notice')
const error = element('error')
const back = button('back')
const next = button('continue')
const claude = element('claude')
const claudeMessage = element('claude-message')
const claudeCommand = element('claude-command')
const claudeGit = element('claude-git')
const claudeOutput = element('claude-output')
const install = button('claude-install')
const check = button('claude-check')
const folder = element('folder')
const folderMessage = element('folder-message')
const folderPath = element('folder-path')
const chooseFolder = button('folder-choose')
const signIn = element('sign-in')
const signInKey = element('sign-in-key')
const signInMessage = element('sign-in-message')
const testClaude = button('sign-in-test')
const restartClaude = button('sign-in-restart')
const model = element('model')
const modelMessage = element('model-message')
const modelProgress = element('model-progress') as HTMLProgressElement
const modelRetry = button('model-retry')
const mic = element('mic')
const micMessage = element('mic-message')
const micHeard = element('mic-heard')
const micProblem = element('mic-problem')
const micSkip = button('mic-skip')
const chrome = element('chrome')
const chromeMessage = element('chrome-message')
const chromeAccount = element('chrome-account')
const chromeOpen: Record<ChromeBrowser, HTMLButtonElement> = {
  chrome: button('chrome-open-chrome'),
  brave: button('chrome-open-brave')
}
const chromeCheck = button('chrome-check')
const chromeConfirm = button('chrome-confirm')

const BROWSER_NAMES: Record<ChromeBrowser, string> = { chrome: 'Chrome', brave: 'Brave' }

/** What the step says. */
function claudeText(state: ClaudeStepStatus): string {
  switch (state.status) {
    case 'checking':
      return 'Looking for Claude Code…'
    case 'ready':
      return state.version === null
        ? "Claude Code found. VoiceUp couldn't read its version, so it will try it anyway."
        : `Claude Code ${state.version} found.`
    case 'missing':
      return "Claude Code isn't installed. VoiceUp can install it with Anthropic's official installer, by running this in PowerShell:"
    case 'tooOld':
      return `Claude Code ${state.version} is too old. VoiceUp needs ${state.minimum} or newer. Run this in PowerShell, then check again:`
    case 'installing':
      return 'Installing Claude Code. This can take a few minutes.'
    case 'failed':
      return "That didn't finish. Check your connection and try again. This is what will run in PowerShell:"
  }
}

function drawClaude(state: ClaudeStepStatus): void {
  claudeMessage.textContent = claudeText(state)
  const command = 'command' in state ? state.command : null
  claudeCommand.textContent = command
  claudeCommand.hidden = command === null
  const canInstall = state.status === 'missing' || state.status === 'failed'
  claudeGit.hidden = !canInstall
  install.hidden = !canInstall
  install.textContent = state.status === 'failed' ? 'Try again' : 'Install'
  check.hidden = state.status === 'checking' || state.status === 'installing'
  claudeOutput.hidden = claudeOutput.textContent === ''
  // The buttons appearing makes the box shorter, and its last lines explain any failure.
  claudeOutput.scrollTop = claudeOutput.scrollHeight
}

function drawFolder({ path, missing }: FolderStepStatus): void {
  folderMessage.textContent = missing
    ? 'That folder no longer exists, so choose another:'
    : path === null
      ? 'Claude can read and change the files there.'
      : 'Claude will work in this folder:'
  folderPath.textContent = path
  folderPath.hidden = path === null
  chooseFolder.textContent = path === null || missing ? 'Choose folder' : 'Change folder'
}

function signInText(state: SignInStatus): string {
  switch (state.status) {
    case 'waiting':
      return 'Waiting for Claude to be ready. If it has finished and nothing changes here, restart it.'
    case 'ready':
      return 'Claude is ready. Test Claude sends it "reply with OK", which uses a tiny bit of your Claude usage.'
    case 'testing':
      return "Waiting for Claude's reply…"
    case 'done':
      return 'Claude replied, so you are signed in.'
    case 'failed':
      return `${state.title}. ${state.detail}`
  }
}

function drawSignIn(view: WizardView): void {
  const state = view.signIn
  signInMessage.textContent = signInText(state)
  signInKey.textContent =
    view.apiKeyWarning === null ? '' : `${view.apiKeyWarning.title}. ${view.apiKeyWarning.detail}`
  signInKey.hidden = view.apiKeyWarning === null
  testClaude.disabled = !(state.status === 'ready' || (state.status === 'failed' && state.canTest))
  testClaude.hidden = state.status === 'done'
  restartClaude.hidden = state.status === 'done' || state.status === 'testing'
}

function drawModel(state: ModelStepStatus): void {
  const name = `${state.label}, ${state.size}`
  modelMessage.textContent =
    state.phase === 'ready'
      ? `The speech model is installed: ${state.label}.`
      : state.phase === 'failed'
        ? 'Speech model download failed. Check your connection and try again. It carries on from where it stopped.'
        : state.phase === 'unpacking'
          ? `Unpacking ${name}…`
          : state.phase === 'downloading'
            ? `Downloading ${name}. VoiceUp turns speech into text on this PC, so nothing you say leaves it.`
            : `Getting ready to download ${name}…`
  const busy = state.phase === 'downloading' || state.phase === 'unpacking'
  modelProgress.hidden = !busy
  modelProgress.value = state.percent
  modelRetry.hidden = state.phase !== 'failed'
}

function drawMic(state: MicStepStatus): void {
  micMessage.textContent =
    state.hotkeyOn === false
      ? `Another app is using ${state.hotkey}, so VoiceUp can't. Close that app and open VoiceUp again, or skip the test.`
      : `Press ${state.hotkey} and say: hello Claude. VoiceUp shows what it heard here, and sends nothing to Claude.`
  micHeard.textContent = state.heard === null ? '' : `Heard: “${state.heard}”`
  micHeard.hidden = state.heard === null
  micProblem.textContent =
    state.problem === null ? '' : `${state.problem.title}. ${state.problem.detail}`
  micProblem.hidden = state.problem === null
  micSkip.hidden = state.heard !== null || state.skipped
}

function chromeText(state: ChromeStepStatus): string {
  switch (state.status) {
    case 'noBrowser':
      return 'Claude in Chrome needs Google Chrome or Brave, and neither is installed. Install one, open it once, then check again.'
    case 'needed':
      return 'Add the Claude extension from the Chrome Web Store. VoiceUp opens its page, and you choose Add to Chrome there, in Brave too.'
    case 'installed':
      return state.browser === null
        ? 'You said Claude in Chrome is installed.'
        : `Claude in Chrome is installed in ${BROWSER_NAMES[state.browser]}.`
  }
}

function drawChrome(state: ChromeStepStatus): void {
  chromeMessage.textContent = chromeText(state)
  const browsers = state.status === 'needed' ? state.browsers : []
  for (const [browser, open] of Object.entries(chromeOpen) as [
    ChromeBrowser,
    HTMLButtonElement
  ][]) {
    open.hidden = !browsers.includes(browser)
  }
  chromeAccount.hidden = state.status !== 'needed'
  chromeCheck.hidden = state.status === 'installed'
  chromeConfirm.hidden = state.status === 'installed'
}

function draw(view: WizardView): void {
  steps.replaceChildren(
    ...view.steps.map((step, index) => {
      const item = document.createElement('li')
      item.textContent = step.title
      item.dataset['done'] = String(step.done)
      if (index === view.index) item.setAttribute('aria-current', 'step')
      return item
    })
  )
  const step = view.steps[view.index]
  position.textContent = `Step ${String(view.index + 1)} of ${String(view.steps.length)}`
  title.textContent = step.title
  detail.textContent = step.detail
  const onClaude = step.id === 'claudeCode'
  claude.hidden = !onClaude
  const onFolder = step.id === 'projectFolder'
  folder.hidden = !onFolder
  const onSignIn = step.id === 'signIn'
  signIn.hidden = !onSignIn
  const onModel = step.id === 'speechModel'
  model.hidden = !onModel
  const onMic = step.id === 'micAndHotkey'
  mic.hidden = !onMic
  const onChrome = step.id === 'claudeInChrome'
  chrome.hidden = !onChrome
  notice.hidden = onClaude || onFolder || onSignIn || onModel || onMic || onChrome
  if (onChrome) drawChrome(view.chrome)
  if (onSignIn) drawSignIn(view)
  if (onModel) drawModel(view.model)
  if (onMic) drawMic(view.mic)
  if (onClaude) drawClaude(view.claude)
  if (onFolder) drawFolder(view.folder)
  back.disabled = view.index === 0
  next.disabled = !view.canContinue
  next.textContent = view.index === view.steps.length - 1 ? 'Finish' : 'Continue'
  if (view.canContinue) next.focus()
  else if (onFolder) chooseFolder.focus()
}

/** One request at a time, so a double click can't skip a step. */
async function run(request: () => Promise<WizardResult>): Promise<void> {
  back.disabled = true
  next.disabled = true
  try {
    const result = await request()
    if (!result.ok) throw new Error(result.code)
    error.hidden = true
    draw(result.data)
  } catch (failure: unknown) {
    // A warning: the smoke test loads this page with nothing in main to answer it.
    console.warn('The setup step did not respond', failure)
    error.textContent = 'Something went wrong. Close this window and open VoiceUp again.'
    error.hidden = false
  }
}

back.addEventListener('click', () => {
  void run(() => window.voiceupWizard.back())
})
next.addEventListener('click', () => {
  void run(() => window.voiceupWizard.next())
})
install.addEventListener('click', () => {
  claudeOutput.textContent = ''
  void run(() => window.voiceupWizard.installClaude())
})
check.addEventListener('click', () => {
  void run(() => window.voiceupWizard.checkClaude())
})
chooseFolder.addEventListener('click', () => {
  void run(() => window.voiceupWizard.chooseFolder())
})
testClaude.addEventListener('click', () => {
  void run(() => window.voiceupWizard.testClaude())
})
restartClaude.addEventListener('click', () => {
  void run(() => window.voiceupWizard.restartClaude())
})
modelRetry.addEventListener('click', () => {
  void run(() => window.voiceupWizard.retryModel())
})
micSkip.addEventListener('click', () => {
  void run(() => window.voiceupWizard.skipMicTest())
})
for (const [browser, open] of Object.entries(chromeOpen) as [ChromeBrowser, HTMLButtonElement][]) {
  open.addEventListener('click', () => {
    void run(() => window.voiceupWizard.openChromeStore(browser))
  })
}
chromeCheck.addEventListener('click', () => {
  void run(() => window.voiceupWizard.checkChrome())
})
chromeConfirm.addEventListener('click', () => {
  void run(() => window.voiceupWizard.confirmChrome())
})
window.voiceupWizard.onChanged(draw)
window.voiceupWizard.onOutput((text) => {
  claudeOutput.textContent = (claudeOutput.textContent + text).slice(-MAX_OUTPUT_CHARS)
  claudeOutput.hidden = false
  claudeOutput.scrollTop = claudeOutput.scrollHeight
})
void run(() => window.voiceupWizard.view())
