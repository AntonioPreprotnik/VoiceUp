import type {
  ClaudeStepStatus,
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
  notice.hidden = onClaude
  if (onClaude) drawClaude(view.claude)
  back.disabled = view.index === 0
  next.disabled = !view.canContinue
  next.textContent = view.index === view.steps.length - 1 ? 'Finish' : 'Continue'
  if (view.canContinue) next.focus()
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
window.voiceupWizard.onChanged(draw)
window.voiceupWizard.onOutput((text) => {
  claudeOutput.textContent = (claudeOutput.textContent + text).slice(-MAX_OUTPUT_CHARS)
  claudeOutput.hidden = false
  claudeOutput.scrollTop = claudeOutput.scrollHeight
})
void run(() => window.voiceupWizard.view())
