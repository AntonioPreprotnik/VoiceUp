import type { WizardApi, WizardResult, WizardView } from '../../shared/ipcChannels'

// The first-run wizard. Main holds the progress, so this only draws what it is sent.

declare global {
  interface Window {
    readonly voiceupWizard: WizardApi
  }
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`The wizard page is missing #${id}`)
  return found
}

const steps = element('steps')
const position = element('position')
const title = element('title')
const detail = element('detail')
const error = element('error')
const back = element('back') as HTMLButtonElement
const next = element('continue') as HTMLButtonElement

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
  back.disabled = view.index === 0
  next.textContent = view.index === view.steps.length - 1 ? 'Finish' : 'Continue'
  next.focus()
}

/** One request at a time, so a double click can't skip a step. */
async function run(request: () => Promise<WizardResult>): Promise<void> {
  back.disabled = true
  next.disabled = true
  try {
    const result = await request()
    if (!result.ok) throw new Error(result.code)
    error.hidden = true
    next.disabled = false
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
void run(() => window.voiceupWizard.view())
