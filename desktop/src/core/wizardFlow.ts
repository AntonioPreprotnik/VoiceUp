import type { WizardView } from '../shared/ipcChannels'

/** In the order of the plan (S6.2). The folder comes first because sign-in needs one to start in. */
const STEPS = [
  {
    id: 'claudeCode',
    title: 'Claude Code',
    detail: 'VoiceUp checks that Claude Code is installed.'
  },
  { id: 'projectFolder', title: 'Project folder', detail: 'Choose the folder Claude works in.' },
  { id: 'signIn', title: 'Sign in', detail: 'Connect your own Claude account.' },
  {
    id: 'speechModel',
    title: 'Speech model',
    detail: 'Download the model that turns speech into text.'
  },
  {
    id: 'claudeInChrome',
    title: 'Claude in Chrome',
    detail: 'Let Claude use your browser. You can skip this.'
  },
  { id: 'micAndHotkey', title: 'Microphone and hotkey', detail: 'Check that VoiceUp can hear you.' }
] as const

/**
 * Where the user is in the wizard. Saved progress may name steps this version doesn't have, after
 * a downgrade, so those are ignored rather than treated as bad settings.
 */
export class WizardFlow {
  private readonly finishedSteps: Set<string>
  private index: number
  private isFinished = false

  constructor(completed: readonly string[]) {
    this.finishedSteps = new Set(completed)
    const next = STEPS.findIndex(({ id }) => !this.finishedSteps.has(id))
    this.index = next === -1 ? STEPS.length - 1 : next
  }

  get finished(): boolean {
    return this.isFinished
  }

  /** Every saved step, including any this version doesn't know, so nothing is lost on an upgrade. */
  get completed(): readonly string[] {
    return [...this.finishedSteps]
  }

  get view(): WizardView {
    return {
      steps: STEPS.map(({ id, title, detail }) => ({
        id,
        title,
        detail,
        done: this.finishedSteps.has(id)
      })),
      index: this.index
    }
  }

  /** Finishes this step and moves on. True when that was the last step. */
  next(): boolean {
    if (this.isFinished) return false
    this.finishedSteps.add(STEPS[this.index].id)
    if (this.index === STEPS.length - 1) this.isFinished = true
    else this.index++
    return this.isFinished
  }

  /** Only moves the view: a step already finished stays finished. */
  back(): void {
    if (!this.isFinished && this.index > 0) this.index--
  }
}
